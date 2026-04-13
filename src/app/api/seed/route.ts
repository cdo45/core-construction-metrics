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

    // Insert default categories (skip if they already exist by name)
    const defaultCategories = [
      { name: "Cash on Hand",        sort_order: 1, color: "#548235" },
      { name: "Who Owes Us",         sort_order: 2, color: "#4472C4" },
      { name: "Who We Owe",          sort_order: 3, color: "#C00000" },
      { name: "Payroll Liabilities", sort_order: 4, color: "#ED7D31" },
    ];

    for (const cat of defaultCategories) {
      await sql`
        INSERT INTO categories (name, sort_order, color)
        VALUES (${cat.name}, ${cat.sort_order}, ${cat.color})
        ON CONFLICT DO NOTHING
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
