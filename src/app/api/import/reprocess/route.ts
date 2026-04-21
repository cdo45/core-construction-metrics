import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildImportPreview } from "@/lib/csv-parser";
import type { NormalizedRow } from "@/lib/csv-reader";

export const runtime = "nodejs";

interface StagedRow extends Omit<NormalizedRow, "dateBooked"> {
  dateBooked: string;
}

export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const { sessionId } = (await req.json()) as { sessionId: string };

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    // Load staged rows
    const staging = await sql`
      SELECT filename, rows FROM import_staging WHERE session_id = ${sessionId}
    `;
    if (staging.length === 0) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const filename = String(staging[0].filename);
    const stagedRows = staging[0].rows as StagedRow[];

    // Rehydrate dates
    const rows: NormalizedRow[] = stagedRows.map((r) => ({
      ...r,
      dateBooked: new Date(r.dateBooked),
    }));

    // Re-run preview (picks up any newly added gl_accounts)
    const preview = await buildImportPreview(filename, rows, sql);

    // Serialize dates for JSON transport
    const previewJson = {
      sessionId,
      ...preview,
      dateRange: {
        min: preview.dateRange.min.toISOString(),
        max: preview.dateRange.max.toISOString(),
      },
      weeksAffected: preview.weeksAffected.map((w) => ({
        ...w,
        weekEnding: w.weekEnding.toISOString(),
      })),
    };

    return NextResponse.json(previewJson);
  } catch (err) {
    console.error("POST /api/import/reprocess error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
