import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/bid-activity?week_ending=YYYY-MM-DD
 * Returns bid data for the given week, or null if none.
 */
export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const { searchParams } = new URL(req.url);
    const weekEnding = searchParams.get("week_ending");

    if (!weekEnding) {
      return NextResponse.json(
        { error: "week_ending query param is required" },
        { status: 400 }
      );
    }

    const rows = await sql`
      SELECT
        id,
        week_ending::text,
        bids_submitted_count,
        bids_submitted_value,
        bids_won_count,
        bids_won_value,
        notes,
        created_at
      FROM bid_activity
      WHERE week_ending = ${weekEnding}::date
    `;

    return NextResponse.json(rows.length > 0 ? rows[0] : null);
  } catch (err) {
    console.error("GET /api/bid-activity error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/bid-activity
 * Upserts bid activity for the given week.
 */
export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const body = await req.json();
    const {
      week_ending,
      bids_submitted_count = 0,
      bids_submitted_value = 0,
      bids_won_count = 0,
      bids_won_value = 0,
      notes = null,
    } = body;

    if (!week_ending) {
      return NextResponse.json({ error: "week_ending is required" }, { status: 400 });
    }

    const [row] = await sql`
      INSERT INTO bid_activity (
        week_ending, bids_submitted_count, bids_submitted_value,
        bids_won_count, bids_won_value, notes
      )
      VALUES (
        ${week_ending}::date,
        ${bids_submitted_count},
        ${bids_submitted_value},
        ${bids_won_count},
        ${bids_won_value},
        ${notes}
      )
      ON CONFLICT (week_ending) DO UPDATE
        SET bids_submitted_count = EXCLUDED.bids_submitted_count,
            bids_submitted_value = EXCLUDED.bids_submitted_value,
            bids_won_count       = EXCLUDED.bids_won_count,
            bids_won_value       = EXCLUDED.bids_won_value,
            notes                = EXCLUDED.notes
      RETURNING *
    `;

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    console.error("POST /api/bid-activity error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
