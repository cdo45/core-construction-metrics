import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST() {
  try {
    const sql = getDb();

    // Create categories table
    await sql`
      CREATE TABLE IF NOT EXISTS categories (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        color      VARCHAR(7) NOT NULL DEFAULT '#000000',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // Create gl_accounts table
    await sql`
      CREATE TABLE IF NOT EXISTS gl_accounts (
        id             SERIAL PRIMARY KEY,
        account_no     INT NOT NULL UNIQUE,
        description    VARCHAR(200) NOT NULL,
        normal_balance VARCHAR(6) NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
        category_id    INT REFERENCES categories(id),
        is_active      BOOLEAN NOT NULL DEFAULT TRUE,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // Create weekly_balances table
    await sql`
      CREATE TABLE IF NOT EXISTS weekly_balances (
        id             SERIAL PRIMARY KEY,
        week_ending    DATE NOT NULL,
        gl_account_id  INT NOT NULL REFERENCES gl_accounts(id),
        beg_balance    NUMERIC(15,2) NOT NULL DEFAULT 0,
        end_balance    NUMERIC(15,2) NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (week_ending, gl_account_id)
      )
    `;

    // Safety: coerce balance columns to NUMERIC(15,2) for DBs created before
    // the type was explicit. Altering NUMERIC(15,2) → NUMERIC(15,2) is a no-op.
    await sql`
      ALTER TABLE weekly_balances
        ALTER COLUMN beg_balance TYPE NUMERIC(15,2)
          USING beg_balance::NUMERIC(15,2),
        ALTER COLUMN end_balance TYPE NUMERIC(15,2)
          USING end_balance::NUMERIC(15,2)
    `;

    // Create bid_activity table
    await sql`
      CREATE TABLE IF NOT EXISTS bid_activity (
        id                   SERIAL PRIMARY KEY,
        week_ending          DATE NOT NULL UNIQUE,
        bids_submitted_count INT NOT NULL DEFAULT 0,
        bids_submitted_value NUMERIC(15,2) NOT NULL DEFAULT 0,
        bids_won_count       INT NOT NULL DEFAULT 0,
        bids_won_value       NUMERIC(15,2) NOT NULL DEFAULT 0,
        notes                TEXT,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // Safety: same column-type coercion for DBs seeded before explicit NUMERIC.
    await sql`
      ALTER TABLE bid_activity
        ALTER COLUMN bids_submitted_value TYPE NUMERIC(15,2)
          USING bids_submitted_value::NUMERIC(15,2),
        ALTER COLUMN bids_won_value TYPE NUMERIC(15,2)
          USING bids_won_value::NUMERIC(15,2)
    `;

    // Create weekly_notes table
    await sql`
      CREATE TABLE IF NOT EXISTS weekly_notes (
        id          SERIAL PRIMARY KEY,
        week_ending DATE NOT NULL UNIQUE,
        doc_link    TEXT,
        summary     TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // Create weekly_transactions table (Foundation Full GL import)
    await sql`
      CREATE TABLE IF NOT EXISTS weekly_transactions (
        id              SERIAL PRIMARY KEY,
        week_ending     DATE NOT NULL,
        gl_account_id   INT NOT NULL REFERENCES gl_accounts(id),
        full_account_no VARCHAR(20),
        trx_date        DATE,
        journal         VARCHAR(10),
        audit_no        VARCHAR(20),
        gl_trx_no       VARCHAR(20),
        line            VARCHAR(10),
        job             VARCHAR(50),
        description     VARCHAR(255),
        debit           NUMERIC(15,2) NOT NULL DEFAULT 0,
        credit          NUMERIC(15,2) NOT NULL DEFAULT 0,
        vendor_cust_no  VARCHAR(20),
        trx_no          VARCHAR(20),
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_wt_week    ON weekly_transactions(week_ending)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_wt_account ON weekly_transactions(gl_account_id)
    `;

    // Create weekly_overhead_spend table (Foundation Div 99 overhead import)
    await sql`
      CREATE TABLE IF NOT EXISTS weekly_overhead_spend (
        id                        SERIAL PRIMARY KEY,
        week_ending               DATE          NOT NULL,
        gl_account_id             INT           NOT NULL REFERENCES gl_accounts(id),
        division                  VARCHAR(10)   NOT NULL DEFAULT '99',
        weekly_debit              NUMERIC(15,2) NOT NULL DEFAULT 0,
        weekly_credit             NUMERIC(15,2) NOT NULL DEFAULT 0,
        net_activity              NUMERIC(15,2) NOT NULL DEFAULT 0,
        excluded_ye_reclass_gross NUMERIC(15,2) NOT NULL DEFAULT 0,
        source_file               VARCHAR(255),
        created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        UNIQUE (week_ending, gl_account_id, division)
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_wos_week    ON weekly_overhead_spend(week_ending)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_wos_account ON weekly_overhead_spend(gl_account_id)
    `;

    // Create import_log table (audit trail for every import attempt)
    await sql`
      CREATE TABLE IF NOT EXISTS import_log (
        id            SERIAL       PRIMARY KEY,
        import_type   VARCHAR(20)  NOT NULL CHECK (import_type IN ('full_gl', 'overhead')),
        week_ending   DATE         NOT NULL,
        status        VARCHAR(10)  NOT NULL CHECK (status IN ('success', 'failed')),
        rows_imported INT          NOT NULL DEFAULT 0,
        total_debit   NUMERIC(15,2),
        total_credit  NUMERIC(15,2),
        net_total     NUMERIC(15,2),
        warnings      JSONB,
        error_message TEXT,
        source_file   VARCHAR(255),
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_il_week ON import_log(week_ending)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_il_type ON import_log(import_type)
    `;

    // ── Seed default categories ───────────────────────────────────────────────
    // WHERE NOT EXISTS keeps this idempotent (categories has no UNIQUE on name).
    const defaultCategories = [
      { name: "Cash on Hand",        sort_order: 1, color: "#548235" },
      { name: "Who Owes Us",         sort_order: 2, color: "#4472C4" },
      { name: "Who We Owe",          sort_order: 3, color: "#C00000" },
      { name: "Payroll Liabilities", sort_order: 4, color: "#ED7D31" },
      { name: "Overhead (Div 99)",   sort_order: 5, color: "#E67E22" },
    ];

    for (const cat of defaultCategories) {
      await sql`
        INSERT INTO categories (name, sort_order, color)
        SELECT ${cat.name}, ${cat.sort_order}, ${cat.color}
        WHERE NOT EXISTS (
          SELECT 1 FROM categories WHERE name = ${cat.name}
        )
      `;
    }

    // ── Seed default GL accounts ──────────────────────────────────────────────
    // category_id resolved by name so this is independent of insertion order.
    const defaultAccounts = [
      {
        account_no: 1290,
        description: "COSTS IN EXCESS",
        normal_balance: "debit",
        category: "Who Owes Us",
      },
      {
        account_no: 2030,
        description: "BILLINGS IN EXCESS",
        normal_balance: "credit",
        category: "Who We Owe",
      },
      {
        account_no: 2600,
        description: "Contract Loss Accrual",
        normal_balance: "credit",
        category: "Who We Owe",
      },
    ] as const;

    for (const acct of defaultAccounts) {
      await sql`
        INSERT INTO gl_accounts (account_no, description, normal_balance, category_id)
        SELECT
          ${acct.account_no},
          ${acct.description},
          ${acct.normal_balance},
          (SELECT id FROM categories WHERE name = ${acct.category} LIMIT 1)
        WHERE NOT EXISTS (
          SELECT 1 FROM gl_accounts WHERE account_no = ${acct.account_no}
        )
      `;
    }

    return NextResponse.json(
      { success: true, message: "Database seeded successfully." },
      { status: 200 }
    );
  } catch (err) {
    console.error("Seed error:", err);
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}
