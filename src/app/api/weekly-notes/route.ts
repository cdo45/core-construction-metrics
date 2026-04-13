import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/weekly-notes?week_ending=YYYY-MM-DD
 * Returns notes for the given week, or null if none.
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
      SELECT id, week_ending::text, doc_link, summary, created_at
      FROM weekly_notes
      WHERE week_ending = ${weekEnding}::date
    `;

    return NextResponse.json(rows.length > 0 ? rows[0] : null);
  } catch (err) {
    console.error("GET /api/weekly-notes error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/weekly-notes
 * Upserts weekly notes for the given week.
 */
export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const body = await req.json();
    const { week_ending, doc_link = null, summary = null } = body;

    if (!week_ending) {
      return NextResponse.json({ error: "week_ending is required" }, { status: 400 });
    }

    const [row] = await sql`
      INSERT INTO weekly_notes (week_ending, doc_link, summary)
      VALUES (${week_ending}::date, ${doc_link}, ${summary})
      ON CONFLICT (week_ending) DO UPDATE
        SET doc_link = EXCLUDED.doc_link,
            summary  = EXCLUDED.summary
      RETURNING id, week_ending::text, doc_link, summary, created_at
    `;

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    console.error("POST /api/weekly-notes error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
