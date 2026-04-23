import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { computeWeekEnding, buildDedupeHash } from "@/lib/week-math";

export const runtime = "nodejs";
export const maxDuration = 120;

// Shape of rows stored in import_staging.rows JSONB.
// NormalizedRow + ISO-string dateBooked. Extra fields (journalNo, transactionNo)
// are tolerated but not required — older stagings may omit them.
interface StagedRow {
  basicAccountNo: number;
  division: string;
  dateBooked: string;
  debit: number;
  credit: number;
  description?: string;
  accountsDescription?: string;
  auditNumber?: string;
  jobNo?: string;
  vendorNo?: string;
  journalNo?: string;
  transactionNo?: string;
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// POST /api/migrations/seed-excluded-from-staging
// One-shot: for each (filename, latest-session) in import_staging, scan rows,
// insert any row whose (account_no, division) has no matching gl_account into
// excluded_transactions. Idempotent via ON CONFLICT (dedupe_hash) DO NOTHING.
export async function POST() {
  try {
    const sql = getDb();

    // ── 1. Latest staging session per filename ──────────────────────────────
    const sessions = await sql`
      SELECT DISTINCT ON (filename)
        session_id, filename, rows, created_at
      FROM import_staging
      ORDER BY filename, created_at DESC
    `;

    if (sessions.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No staging sessions found.",
        perFile: [],
      });
    }

    // ── 2. All known (account_no, division) pairs from gl_accounts ──────────
    const glRows = await sql`
      SELECT account_no, division FROM gl_accounts
    `;
    const knownKeys = new Set<string>(
      glRows.map((r) => `${Number(r.account_no)}|${String(r.division ?? "")}`)
    );

    const perFile: Array<{ filename: string; scanned: number; inserted: number }> = [];

    for (const session of sessions) {
      const filename = String(session.filename);
      const rows = session.rows as StagedRow[];

      const srcArr: string[] = [];
      const weekArr: string[] = [];
      const dateArr: string[] = [];
      const acctArr: string[] = [];
      const divArr: string[] = [];
      const descArr: (string | null)[] = [];
      const acctDescArr: (string | null)[] = [];
      const drArr: number[] = [];
      const crArr: number[] = [];
      const journalArr: (string | null)[] = [];
      const auditArr: (string | null)[] = [];
      const trxNoArr: (string | null)[] = [];
      const jobArr: (string | null)[] = [];
      const vendorArr: (string | null)[] = [];
      const hashArr: string[] = [];
      const seenHashes = new Set<string>();

      let scanned = 0;

      for (const row of rows) {
        scanned++;
        const key = `${row.basicAccountNo}|${row.division ?? ""}`;
        if (knownKeys.has(key)) continue;

        const dateBooked = new Date(row.dateBooked);
        if (isNaN(dateBooked.getTime())) continue;

        const bounds = computeWeekEnding(dateBooked);
        const weekISO = toISO(bounds.weekEnding);
        const audit = row.auditNumber ?? "";
        const hash = buildDedupeHash(
          weekISO,
          row.basicAccountNo,
          row.division ?? "",
          audit,
          row.debit,
          row.credit
        );

        // Guard against intra-batch duplicates (same hash in same staging).
        // UNNEST + ON CONFLICT would silently drop later rows; dedupe in memory
        // so `inserted` reflects what ends up in the table for THIS batch.
        if (seenHashes.has(hash)) continue;
        seenHashes.add(hash);

        srcArr.push(filename);
        weekArr.push(weekISO);
        dateArr.push(toISO(dateBooked));
        acctArr.push(String(row.basicAccountNo));
        divArr.push(row.division ?? "");
        descArr.push(row.description ?? null);
        acctDescArr.push(row.accountsDescription ?? null);
        drArr.push(row.debit);
        crArr.push(row.credit);
        journalArr.push(row.journalNo ?? null);
        auditArr.push(audit || null);
        trxNoArr.push(row.transactionNo ?? null);
        jobArr.push(row.jobNo ?? null);
        vendorArr.push(row.vendorNo ?? null);
        hashArr.push(hash);
      }

      let inserted = 0;
      if (hashArr.length > 0) {
        const result = await sql`
          INSERT INTO excluded_transactions (
            source_file, week_ending, date_booked, basic_account_no, division,
            description, account_description, debit, credit,
            journal_no, audit_number, transaction_no, job_no, vendor_no, dedupe_hash
          )
          SELECT * FROM UNNEST(
            ${srcArr}::text[],
            ${weekArr}::date[],
            ${dateArr}::date[],
            ${acctArr}::text[],
            ${divArr}::text[],
            ${descArr}::text[],
            ${acctDescArr}::text[],
            ${drArr}::numeric[],
            ${crArr}::numeric[],
            ${journalArr}::text[],
            ${auditArr}::text[],
            ${trxNoArr}::text[],
            ${jobArr}::text[],
            ${vendorArr}::text[],
            ${hashArr}::text[]
          )
          ON CONFLICT (dedupe_hash) DO NOTHING
          RETURNING id
        `;
        inserted = result.length;
      }

      perFile.push({ filename, scanned, inserted });
    }

    const totalInserted = perFile.reduce((a, b) => a + b.inserted, 0);

    return NextResponse.json({
      success: true,
      totalInserted,
      perFile,
    });
  } catch (err) {
    console.error("POST /api/migrations/seed-excluded-from-staging error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
