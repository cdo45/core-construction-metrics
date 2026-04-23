import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/excluded-accounts
// Aggregated roll-up of excluded_transactions (only rows where activated_at IS NULL),
// grouped by (basic_account_no, division).
export async function GET() {
  try {
    const sql = getDb();

    const rows = await sql`
      SELECT
        basic_account_no,
        division,
        MAX(account_description) AS description,
        COUNT(*)::int           AS tx_count,
        ROUND(SUM(debit)::numeric,  2) AS total_dr,
        ROUND(SUM(credit)::numeric, 2) AS total_cr,
        MIN(date_booked)::text   AS first_seen,
        MAX(date_booked)::text   AS last_seen,
        COUNT(DISTINCT week_ending)::int AS weeks_affected,
        ARRAY_AGG(DISTINCT source_file) AS sources
      FROM excluded_transactions
      WHERE activated_at IS NULL
      GROUP BY basic_account_no, division
      ORDER BY basic_account_no, division
    `;

    const result = rows.map((r) => ({
      basic_account_no: String(r.basic_account_no),
      division: String(r.division ?? ""),
      description: r.description != null ? String(r.description) : "",
      tx_count: Number(r.tx_count),
      total_dr: parseFloat(String(r.total_dr)),
      total_cr: parseFloat(String(r.total_cr)),
      first_seen: String(r.first_seen),
      last_seen: String(r.last_seen),
      weeks_affected: Number(r.weeks_affected),
      sources: (r.sources as unknown as string[]) ?? [],
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/excluded-accounts error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
