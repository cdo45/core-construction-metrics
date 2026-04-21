import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { computeWeekEnding, buildDedupeHash } from "@/lib/week-math";
import type { NormalizedRow } from "@/lib/csv-reader";

export const runtime = "nodejs";
export const maxDuration = 120;

// Serialized shape stored in import_staging JSONB
interface StagedRow extends Omit<NormalizedRow, "dateBooked"> {
  dateBooked: string; // ISO string
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const { sessionId } = (await req.json()) as { sessionId: string };

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    // ── Load staged rows ──────────────────────────────────────────────────────
    const staging = await sql`
      SELECT filename, rows FROM import_staging WHERE session_id = ${sessionId}
    `;
    if (staging.length === 0) {
      return NextResponse.json(
        { error: "Session not found or already committed." },
        { status: 404 }
      );
    }

    const filename = String(staging[0].filename);
    const stagedRows: StagedRow[] = staging[0].rows as StagedRow[];

    // Rehydrate dates
    const rows: NormalizedRow[] = stagedRows.map((r) => ({
      ...r,
      dateBooked: new Date(r.dateBooked),
    }));

    // ── GL account lookup: (account_no, division) → { id, normalBalance, categoryId } ─
    const uniqueKeys = new Set(rows.map((r) => `${r.basicAccountNo}|${r.division}`));
    const glLookup = new Map<
      string,
      { id: number; normalBalance: string; categoryId: number | null }
    >();
    for (const key of uniqueKeys) {
      const [acctStr, div] = key.split("|");
      const dbRows = await sql`
        SELECT id, normal_balance, category_id
        FROM gl_accounts
        WHERE account_no = ${parseInt(acctStr, 10)} AND division = ${div}
        LIMIT 1
      `;
      if (dbRows.length > 0) {
        glLookup.set(key, {
          id: Number(dbRows[0].id),
          normalBalance: String(dbRows[0].normal_balance),
          categoryId: dbRows[0].category_id != null ? Number(dbRows[0].category_id) : null,
        });
      }
    }

    // ── Load existing dedupe hashes for this date range ───────────────────────
    const allDates = rows.map((r) => r.dateBooked);
    const minISO = toISO(new Date(Math.min(...allDates.map((d) => d.getTime()))));
    const maxISO = toISO(new Date(Math.max(...allDates.map((d) => d.getTime()))));
    const existingHashRows = await sql`
      SELECT dedupe_hash FROM weekly_transactions
      WHERE week_ending BETWEEN ${minISO}::date AND ${maxISO}::date
        AND dedupe_hash IS NOT NULL
    `;
    const existingHashes = new Set(existingHashRows.map((r) => String(r.dedupe_hash)));

    // ── Bucket new (non-duplicate) rows by (weekISO, glId) ───────────────────
    interface RowBucket {
      weekEnding: string;
      glId: number;
      normalBalance: string;
      debits: number;
      credits: number;
      rowsToInsert: NormalizedRow[];
    }

    const buckets = new Map<string, RowBucket>();
    const affectedWeeks = new Set<string>();
    let rowsImported = 0;
    let rowsSkipped = 0;

    for (const row of rows) {
      const key = `${row.basicAccountNo}|${row.division}`;
      const gl = glLookup.get(key);
      if (!gl) { rowsSkipped++; continue; }

      const bounds = computeWeekEnding(row.dateBooked);
      const weekISO = toISO(bounds.weekEnding);
      const hash = buildDedupeHash(weekISO, row.basicAccountNo, row.division, row.auditNumber, row.transactionNo);
      if (existingHashes.has(hash)) { rowsSkipped++; continue; }

      const bucketKey = `${weekISO}|${gl.id}`;
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, {
          weekEnding: weekISO,
          glId: gl.id,
          normalBalance: gl.normalBalance,
          debits: 0,
          credits: 0,
          rowsToInsert: [],
        });
      }
      const b = buckets.get(bucketKey)!;
      b.debits += row.debit;
      b.credits += row.credit;
      b.rowsToInsert.push(row);
      affectedWeeks.add(weekISO);
      rowsImported++;
    }

    // ── Find prior week end_balances for beg_balance chaining ────────────────
    // For each affected week, find the prior week_ending from the weeks table
    const priorEndMap = new Map<string, Map<number, number>>(); // weekISO → Map<glId, endBal>
    for (const weekISO of affectedWeeks) {
      const priorRows = await sql`
        SELECT week_ending::text FROM weeks
        WHERE week_ending < ${weekISO}::date
        ORDER BY week_ending DESC LIMIT 1
      `;
      if (priorRows.length === 0) continue;
      const priorWeek = String(priorRows[0].week_ending);

      const balRows = await sql`
        SELECT gl_account_id, end_balance FROM weekly_balances
        WHERE week_ending = ${priorWeek}::date
      `;
      const glMap = new Map<number, number>();
      for (const r of balRows) glMap.set(Number(r.gl_account_id), parseFloat(String(r.end_balance)));
      priorEndMap.set(weekISO, glMap);
    }

    // ── Persist: insert transactions + upsert balances ────────────────────────
    for (const [, bucket] of buckets) {
      // Insert transaction rows
      for (const row of bucket.rowsToInsert) {
        const bounds = computeWeekEnding(row.dateBooked);
        const weekISO = toISO(bounds.weekEnding);
        const hash = buildDedupeHash(weekISO, row.basicAccountNo, row.division, row.auditNumber, row.transactionNo);
        await sql`
          INSERT INTO weekly_transactions
            (week_ending, gl_account_id, trx_date, journal, audit_no, gl_trx_no, line,
             job, description, debit, credit, vendor_cust_no, trx_no, dedupe_hash)
          VALUES (
            ${weekISO}::date,
            ${bucket.glId},
            ${toISO(row.dateBooked)}::date,
            ${row.journalNo},
            ${row.auditNumber},
            ${row.transactionNo},
            ${String(row.lineNo)},
            ${row.jobNo},
            ${row.description},
            ${row.debit},
            ${row.credit},
            ${row.vendorNo},
            ${row.transactionNo},
            ${hash}
          )
          ON CONFLICT DO NOTHING
        `;
      }

      // Compute beg_balance from prior week or existing beg
      const priorMap = priorEndMap.get(bucket.weekEnding);
      const priorEnd = priorMap?.get(bucket.glId) ?? 0;

      // Check if we already have a beg_balance for this (week, account)
      const existingBal = await sql`
        SELECT beg_balance, end_balance FROM weekly_balances
        WHERE week_ending = ${bucket.weekEnding}::date AND gl_account_id = ${bucket.glId}
      `;

      const begBalance = existingBal.length > 0
        ? parseFloat(String(existingBal[0].beg_balance))
        : priorEnd;

      // Compute end_balance based on normal_balance
      let endBalance: number;
      if (bucket.normalBalance === "debit") {
        endBalance = begBalance + bucket.debits - bucket.credits;
      } else {
        endBalance = begBalance - bucket.debits + bucket.credits;
      }

      await sql`
        INSERT INTO weekly_balances
          (week_ending, gl_account_id, beg_balance, end_balance, period_debit, period_credit)
        VALUES (
          ${bucket.weekEnding}::date,
          ${bucket.glId},
          ${begBalance},
          ${endBalance},
          ${bucket.debits},
          ${bucket.credits}
        )
        ON CONFLICT (week_ending, gl_account_id) DO UPDATE
          SET period_debit  = weekly_balances.period_debit  + EXCLUDED.period_debit,
              period_credit = weekly_balances.period_credit + EXCLUDED.period_credit,
              end_balance   = CASE
                WHEN (SELECT normal_balance FROM gl_accounts WHERE id = EXCLUDED.gl_account_id) = 'debit'
                  THEN weekly_balances.beg_balance + (weekly_balances.period_debit + EXCLUDED.period_debit)
                                                   - (weekly_balances.period_credit + EXCLUDED.period_credit)
                ELSE weekly_balances.beg_balance - (weekly_balances.period_debit + EXCLUDED.period_debit)
                                                 + (weekly_balances.period_credit + EXCLUDED.period_credit)
              END
      `;
    }

    // ── Mark affected weeks as confirmed ─────────────────────────────────────
    for (const weekISO of affectedWeeks) {
      await sql`
        UPDATE weeks SET is_confirmed = true, confirmed_at = NOW()
        WHERE week_ending = ${weekISO}::date
      `;
    }

    // ── Log to import_log ─────────────────────────────────────────────────────
    await sql`
      INSERT INTO import_log (filename, rows_imported, rows_skipped, weeks_affected, imported_at)
      VALUES (
        ${filename},
        ${rowsImported},
        ${rowsSkipped},
        ${Array.from(affectedWeeks).join(",")},
        NOW()
      )
      ON CONFLICT DO NOTHING
    `;

    // ── Cleanup staging ───────────────────────────────────────────────────────
    await sql`DELETE FROM import_staging WHERE session_id = ${sessionId}`;

    return NextResponse.json({
      success: true,
      rowsImported,
      rowsSkipped,
      weeksCommitted: Array.from(affectedWeeks).sort(),
    });
  } catch (err) {
    console.error("POST /api/import/confirm error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
