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

    // Safety: if the table was previously created with wrong column types (e.g.
    // INTEGER or unscaled NUMERIC), coerce them to NUMERIC(15,2) now.
    // This is idempotent — altering a NUMERIC(15,2) column to NUMERIC(15,2) is
    // a no-op in Postgres.
    await sql`
      ALTER TABLE weekly_balances
        ALTER COLUMN beg_balance TYPE NUMERIC(15,2)
          USING beg_balance::NUMERIC(15,2),
        ALTER COLUMN end_balance TYPE NUMERIC(15,2)
          USING end_balance::NUMERIC(15,2)
    `;

    // Same safety ALTER for bid_activity value columns.
    await sql`
      ALTER TABLE bid_activity
        ALTER COLUMN bids_submitted_value TYPE NUMERIC(15,2)
          USING bids_submitted_value::NUMERIC(15,2),
        ALTER COLUMN bids_won_value TYPE NUMERIC(15,2)
          USING bids_won_value::NUMERIC(15,2)
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

    // Create weekly_transactions table (Foundation GL import)
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

    // Insert default categories only if a row with that name doesn't already exist.
    // Using WHERE NOT EXISTS instead of ON CONFLICT because categories has no
    // unique constraint on name — this keeps the insert fully idempotent.
    const defaultCategories = [
      { name: "Cash on Hand",        sort_order: 1, color: "#548235" },
      { name: "Who Owes Us",         sort_order: 2, color: "#4472C4" },
      { name: "Who We Owe",          sort_order: 3, color: "#C00000" },
      { name: "Payroll Liabilities", sort_order: 4, color: "#ED7D31" },
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
