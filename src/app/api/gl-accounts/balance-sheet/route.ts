import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT ga.account_no
      FROM gl_accounts ga
      JOIN categories c ON c.id = ga.category_id
      WHERE ga.is_active = TRUE
        AND c.name IN (
          'Cash on Hand',
          'Who Owes Us',
          'Who We Owe',
          'Payroll Liabilities'
        )
      ORDER BY ga.account_no ASC
    `;
    return NextResponse.json({
      account_nos: rows.map((r) => Number(r.account_no)),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
