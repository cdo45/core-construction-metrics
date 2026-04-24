import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

// Accounts we ship as internal allocations by default. 6050 "ALLOCATED
// EQ. COSTS" is a shop→field cost transfer — the cash was already spent
// against other accounts, so it shouldn't add back to cash op income.
// Add more here when new allocation buckets get set up; users can also
// flip additional rows via the CategoryEditor toggle after deploy.
const SEED_ALLOCATION_ACCOUNT_NOS = [6050] as const;

// POST /api/migrations/seed-allocation-flag
// Idempotent two-step migration:
//   1) ADD COLUMN IF NOT EXISTS gl_accounts.is_allocation BOOLEAN NOT NULL DEFAULT false
//   2) Flip is_allocation=true for the seed set, counting only actual flips.
// Returns:
//   { column_already_existed, accounts_updated, flagged_accounts: [...] }
export async function POST() {
  try {
    const sql = getDb();

    const preCheck = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'gl_accounts' AND column_name = 'is_allocation'
      ) AS existed
    `;
    const columnAlreadyExisted = Boolean(preCheck[0]?.existed);

    await sql`
      ALTER TABLE gl_accounts
      ADD COLUMN IF NOT EXISTS is_allocation BOOLEAN NOT NULL DEFAULT false
    `;

    // Only flip rows not already set to true so accounts_updated reflects
    // actual changes this run (0 on re-run).
    const updated = await sql`
      UPDATE gl_accounts
      SET is_allocation = true
      WHERE account_no = ANY(${[...SEED_ALLOCATION_ACCOUNT_NOS]}::int[])
        AND is_allocation = false
      RETURNING id
    `;

    const flagged = await sql`
      SELECT account_no, division, description, is_non_cash, is_allocation
      FROM gl_accounts
      WHERE is_allocation = true
      ORDER BY account_no ASC, division ASC
    `;

    const flagged_accounts = flagged.map((r) => ({
      account_no: Number(r.account_no),
      division: r.division == null ? null : String(r.division),
      description: r.description == null ? null : String(r.description),
      is_non_cash: Boolean(r.is_non_cash),
      is_allocation: Boolean(r.is_allocation),
    }));

    return NextResponse.json({
      column_already_existed: columnAlreadyExisted,
      accounts_updated: updated.length,
      flagged_accounts,
    });
  } catch (err) {
    console.error("POST /api/migrations/seed-allocation-flag error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
