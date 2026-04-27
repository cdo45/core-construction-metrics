import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseFoundationCsv } from "@/lib/csv-reader";
import { buildImportPreview } from "@/lib/csv-parser";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const sql = getDb();

    // ── Create import_staging table if needed ─────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS import_staging (
        session_id  UUID PRIMARY KEY,
        filename    TEXT NOT NULL,
        rows        JSONB NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_import_staging_created ON import_staging(created_at)
    `;

    // ── Parse multipart file ──────────────────────────────────────────────────
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "file field is required" }, { status: 400 });
    }

    const arrayBuffer = await (file as File).arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filename = (file as File).name ?? "upload.csv";

    // ── Normalize rows ────────────────────────────────────────────────────────
    let rows;
    try {
      rows = parseFoundationCsv(buffer);
    } catch (parseErr) {
      return NextResponse.json({ error: String(parseErr) }, { status: 422 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "No valid data rows found in file." }, { status: 422 });
    }

    // ── Build preview (reads DB for GL lookup + dedupe hashes) ────────────────
    const preview = await buildImportPreview(filename, rows, sql);

    // Per-week summary log so multi-chunk same-week uploads are auditable
    // even before the user clicks Confirm.
    const previewNew = preview.weeksAffected.reduce((s, w) => s + w.rowsNew, 0);
    const previewDup = preview.weeksAffected.reduce((s, w) => s + w.rowsDuplicate, 0);
    console.log(
      `[preview] file ${filename}: received ${rows.length}, new ${previewNew}, deduped ${previewDup}, excluded ${preview.outOfScope.rowCount}`
    );
    for (const w of preview.weeksAffected) {
      const wkISO = w.weekEnding.toISOString().slice(0, 10);
      console.log(
        `[preview] week ${wkISO}: ${w.rowsNew} new, ${w.rowsDuplicate} dedupe-skipped`
      );
    }

    // ── Persist rows to staging table ─────────────────────────────────────────
    const sessionId = randomUUID();
    // Dates must be serialized to ISO strings so JSONB round-trips cleanly
    const rowsJson = rows.map((r) => ({
      ...r,
      dateBooked: r.dateBooked.toISOString(),
    }));

    await sql`
      INSERT INTO import_staging (session_id, filename, rows)
      VALUES (${sessionId}, ${filename}, ${JSON.stringify(rowsJson)})
    `;

    // ── Serialize preview dates for JSON transport ────────────────────────────
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
    console.error("POST /api/import/preview error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
