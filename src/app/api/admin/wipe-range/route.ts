import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const body = (await req.json()) as {
      start_date?: string;
      end_date?: string;
      confirm?: boolean;
    };

    const start_date = body?.start_date;
    const end_date = body?.end_date;
    const confirm = body?.confirm === true;

    if (!start_date || !ISO_DATE.test(start_date)) {
      return NextResponse.json(
        { error: "start_date (YYYY-MM-DD) is required" },
        { status: 400 }
      );
    }
    if (!end_date || !ISO_DATE.test(end_date)) {
      return NextResponse.json(
        { error: "end_date (YYYY-MM-DD) is required" },
        { status: 400 }
      );
    }
    if (start_date > end_date) {
      return NextResponse.json(
        { error: "start_date must be <= end_date" },
        { status: 400 }
      );
    }

    if (!confirm) {
      const [weeksRow] = (await sql`
        SELECT COUNT(*)::int AS n
        FROM weeks
        WHERE week_ending BETWEEN ${start_date}::date AND ${end_date}::date
      `) as Array<{ n: number }>;
      const [txRow] = (await sql`
        SELECT COUNT(*)::int AS n
        FROM weekly_transactions
        WHERE week_ending BETWEEN ${start_date}::date AND ${end_date}::date
      `) as Array<{ n: number }>;
      const [balRow] = (await sql`
        SELECT COUNT(*)::int AS n
        FROM weekly_balances
        WHERE week_ending BETWEEN ${start_date}::date AND ${end_date}::date
      `) as Array<{ n: number }>;

      return NextResponse.json({
        mode: "preview",
        start_date,
        end_date,
        weeks_in_range: weeksRow?.n ?? 0,
        transactions_to_delete: txRow?.n ?? 0,
        balances_to_reset_pd_pc: balRow?.n ?? 0,
      });
    }

    // Commit path.
    const txDeleted = (await sql`
      DELETE FROM weekly_transactions
      WHERE week_ending BETWEEN ${start_date}::date AND ${end_date}::date
      RETURNING id
    `) as Array<{ id: number }>;

    const balReset = (await sql`
      UPDATE weekly_balances
      SET period_debit = 0,
          period_credit = 0
      WHERE week_ending BETWEEN ${start_date}::date AND ${end_date}::date
      RETURNING id
    `) as Array<{ id: number }>;

    return NextResponse.json({
      mode: "commit",
      start_date,
      end_date,
      transactions_deleted: txDeleted.length,
      balances_period_reset: balReset.length,
    });
  } catch (err) {
    console.error("/api/admin/wipe-range error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
