import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/migrations/excluded-transactions
// Idempotently create the excluded_transactions table + supporting indexes.
export async function POST() {
  try {
    const sql = getDb();

    await sql`
      CREATE TABLE IF NOT EXISTS excluded_transactions (
        id                         SERIAL PRIMARY KEY,
        source_file                TEXT NOT NULL,
        imported_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        week_ending                DATE NOT NULL,
        date_booked                DATE NOT NULL,
        basic_account_no           TEXT NOT NULL,
        division                   TEXT NOT NULL DEFAULT '',
        description                TEXT,
        account_description        TEXT,
        debit                      NUMERIC(15,2) NOT NULL DEFAULT 0,
        credit                     NUMERIC(15,2) NOT NULL DEFAULT 0,
        journal_no                 TEXT,
        audit_number               TEXT,
        transaction_no             TEXT,
        job_no                     TEXT,
        vendor_no                  TEXT,
        dedupe_hash                TEXT NOT NULL UNIQUE,
        activated_at               TIMESTAMPTZ,
        activated_to_gl_account_id INTEGER REFERENCES gl_accounts(id) ON DELETE SET NULL
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_excl_acct_div
      ON excluded_transactions(basic_account_no, division)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_excl_week
      ON excluded_transactions(week_ending)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_excl_active
      ON excluded_transactions(activated_at)
      WHERE activated_at IS NULL
    `;

    return NextResponse.json({
      success: true,
      message: "excluded_transactions table ready.",
    });
  } catch (err) {
    console.error("POST /api/migrations/excluded-transactions error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
