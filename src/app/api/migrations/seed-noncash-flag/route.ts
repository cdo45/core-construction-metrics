import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

// Accounts we ship as non-cash by default: depreciation / internal
// allocations. Kept narrow on purpose — the CategoryEditor UI lets
// the user flip others after deploy.
const SEED_NONCASH_ACCOUNT_NOS = [6050, 6060] as const;

// POST /api/migrations/seed-noncash-flag
// Idempotent two-step migration:
//   1) ADD COLUMN IF NOT EXISTS gl_accounts.is_non_cash BOOLEAN NOT NULL DEFAULT false
//   2) Flip is_non_cash=true for the seed set, counting only actual flips
//      (AND is_non_cash = false guards the count so re-runs report 0 updates).
// Returns:
//   { column_already_existed, accounts_updated, flagged_accounts: [...] }
export async function POST() {
  try {
    const sql = getDb();

    // Pre-check so we can report whether the column existed before this run.
    const preCheck = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'gl_accounts' AND column_name = 'is_non_cash'
      ) AS existed
    `;
    const columnAlreadyExisted = Boolean(preCheck[0]?.existed);

    await sql`
      ALTER TABLE gl_accounts
      ADD COLUMN IF NOT EXISTS is_non_cash BOOLEAN NOT NULL DEFAULT false
    `;

    // Only flip rows that aren't already true. This keeps accounts_updated
    // equal to the number of rows actually changed this run — 0 on re-run.
    const updated = await sql`
      UPDATE gl_accounts
      SET is_non_cash = true
      WHERE account_no = ANY(${[...SEED_NONCASH_ACCOUNT_NOS]}::int[])
        AND is_non_cash = false
      RETURNING id
    `;

    const flagged = await sql`
      SELECT account_no, division, description
      FROM gl_accounts
      WHERE is_non_cash = true
      ORDER BY account_no ASC, division ASC
    `;

    const flagged_accounts = flagged.map((r) => ({
      account_no: Number(r.account_no),
      division: r.division == null ? null : String(r.division),
      description: r.description == null ? null : String(r.description),
    }));

    return NextResponse.json({
      column_already_existed: columnAlreadyExisted,
      accounts_updated: updated.length,
      flagged_accounts,
    });
  } catch (err) {
    console.error("POST /api/migrations/seed-noncash-flag error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
