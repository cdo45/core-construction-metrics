import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/gl-accounts/scope
 *
 * Returns all active GL accounts with their category information.
 * Used by TrialBalanceImporter to classify parsed rows as in-scope vs out-of-scope.
 */
export async function GET() {
  try {
    const sql = getDb();

    const rows = await sql`
      SELECT
        ga.account_no,
        ga.division,
        ga.description,
        ga.normal_balance,
        ga.is_pl_flow,
        c.name  AS category_name,
        c.color AS category_color
      FROM gl_accounts ga
      LEFT JOIN categories c ON c.id = ga.category_id
      WHERE ga.is_active = TRUE
      ORDER BY c.sort_order ASC, ga.account_no ASC, ga.division ASC
    `;

    return NextResponse.json({
      accounts: rows.map((r) => ({
        account_no:     Number(r.account_no),
        division:       String(r.division ?? ""),
        description:    String(r.description),
        normal_balance: r.normal_balance as "debit" | "credit",
        is_pl_flow:     Boolean(r.is_pl_flow),
        category_name:  r.category_name  as string | null,
        category_color: r.category_color as string | null,
      })),
    });
  } catch (err) {
    console.error("GET /api/gl-accounts/scope error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
