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
    console.log('[confirm] step 1 START: load staging rows');
    const staging = await sql`
      SELECT filename, rows FROM import_staging WHERE session_id = ${sessionId}
    `;
    console.log('[confirm] step 1 DONE: loaded', staging.length, 'rows');
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
    // Single UNNEST query to batch all lookups instead of one SELECT per unique key
    const glLookup = new Map<
      string,
      { id: number; normalBalance: string; categoryId: number | null }
    >();

    const lookupAcctNos: number[] = [];
    const lookupDivisions: string[] = [];
    const seenKeys = new Set<string>();
    for (const r of rows) {
      const key = `${r.basicAccountNo}|${r.division ?? ''}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      lookupAcctNos.push(r.basicAccountNo);
      lookupDivisions.push(r.division ?? '');
    }

    if (lookupAcctNos.length > 0) {
      console.log('[confirm] step 2 START: gl lookup for', lookupAcctNos.length, 'unique keys');
      const glRows = await sql`
        SELECT id, account_no, division, normal_balance, category_id
        FROM gl_accounts
        WHERE (account_no, division) IN (
          SELECT * FROM UNNEST(${lookupAcctNos}::int[], ${lookupDivisions}::text[])
        )
      `;
      console.log('[confirm] step 2 DONE: found', glRows.length, 'gl_accounts rows');
      for (const r of glRows) {
        const key = `${Number(r.account_no)}|${String(r.division ?? '')}`;
        glLookup.set(key, {
          id: Number(r.id),
          normalBalance: String(r.normal_balance),
          categoryId: r.category_id != null ? Number(r.category_id) : null,
        });
      }
    }

    // ── Load existing dedupe hashes for this date range ───────────────────────
    const allDates = rows.map((r) => r.dateBooked);
    const minISO = toISO(new Date(Math.min(...allDates.map((d) => d.getTime()))));
    const maxISO = toISO(new Date(Math.max(...allDates.map((d) => d.getTime()))));
    console.log('[confirm] step 3 START: existing dedupe hashes', minISO, '→', maxISO);
    const existingHashRows = await sql`
      SELECT dedupe_hash FROM weekly_transactions
      WHERE week_ending BETWEEN ${minISO}::date AND ${maxISO}::date
        AND dedupe_hash IS NOT NULL
    `;
    console.log('[confirm] step 3 DONE: found', existingHashRows.length, 'existing hashes');
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
    let rowsDuplicate = 0;
    let rowsOutOfScope = 0;

    // Excluded-row accumulators (parallel arrays for one bulk insert below).
    // Filled when a row's (account_no, division) has no tracked gl_account.
    const exclSrc: string[] = [];
    const exclWeek: string[] = [];
    const exclDate: string[] = [];
    const exclAcct: string[] = [];
    const exclDiv: string[] = [];
    const exclDesc: (string | null)[] = [];
    const exclAcctDesc: (string | null)[] = [];
    const exclDr: number[] = [];
    const exclCr: number[] = [];
    const exclJournal: (string | null)[] = [];
    const exclAudit: (string | null)[] = [];
    const exclTrxNo: (string | null)[] = [];
    const exclJob: (string | null)[] = [];
    const exclVendor: (string | null)[] = [];
    const exclHash: string[] = [];
    const exclSeenHashes = new Set<string>();

    for (const row of rows) {
      const key = `${row.basicAccountNo}|${row.division ?? ''}`;
      const gl = glLookup.get(key);
      if (!gl) {
        rowsOutOfScope++;
        const bounds = computeWeekEnding(row.dateBooked);
        const weekISO = toISO(bounds.weekEnding);
        const hash = buildDedupeHash(weekISO, row.basicAccountNo, row.division ?? '', row.auditNumber, row.debit, row.credit);
        if (!exclSeenHashes.has(hash)) {
          exclSeenHashes.add(hash);
          exclSrc.push(filename);
          exclWeek.push(weekISO);
          exclDate.push(toISO(row.dateBooked));
          exclAcct.push(String(row.basicAccountNo));
          exclDiv.push(row.division ?? '');
          exclDesc.push(row.description ?? null);
          exclAcctDesc.push((row as unknown as { accountsDescription?: string }).accountsDescription ?? null);
          exclDr.push(row.debit);
          exclCr.push(row.credit);
          exclJournal.push((row as unknown as { journalNo?: string }).journalNo ?? null);
          exclAudit.push(row.auditNumber || null);
          exclTrxNo.push((row as unknown as { transactionNo?: string }).transactionNo ?? null);
          exclJob.push(row.jobNo || null);
          exclVendor.push(row.vendorNo || null);
          exclHash.push(hash);
        }
        continue;
      }

      const bounds = computeWeekEnding(row.dateBooked);
      const weekISO = toISO(bounds.weekEnding);
      const hash = buildDedupeHash(weekISO, row.basicAccountNo, row.division, row.auditNumber, row.debit, row.credit);
      if (existingHashes.has(hash)) { rowsDuplicate++; continue; }

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

    console.log('[confirm] processing', rowsImported, 'rows across', affectedWeeks.size, 'weeks');

    // ── Persist: bulk-insert all transactions in one statement ───────────────
    const txWeekEndings: string[] = [];
    const txGlIds: number[] = [];
    const txBasicAccountNos: number[] = [];
    const txDivisions: string[] = [];
    const txDateBookeds: string[] = [];
    const txAuditNumbers: string[] = [];
    const txJobNos: string[] = [];
    const txDescriptions: string[] = [];
    const txDebits: number[] = [];
    const txCredits: number[] = [];
    const txVendorNos: string[] = [];
    const txHashes: string[] = [];

    for (const bucket of buckets.values()) {
      for (const row of bucket.rowsToInsert) {
        const bounds = computeWeekEnding(row.dateBooked);
        const weekISO = toISO(bounds.weekEnding);
        const hash = buildDedupeHash(weekISO, row.basicAccountNo, row.division, row.auditNumber, row.debit, row.credit);
        txWeekEndings.push(weekISO);
        txGlIds.push(bucket.glId);
        txBasicAccountNos.push(row.basicAccountNo);
        txDivisions.push(row.division ?? '');
        txDateBookeds.push(toISO(row.dateBooked));
        txAuditNumbers.push(row.auditNumber);
        txJobNos.push(row.jobNo);
        txDescriptions.push(row.description);
        txDebits.push(row.debit);
        txCredits.push(row.credit);
        txVendorNos.push(row.vendorNo);
        txHashes.push(hash);
      }
    }

    // ── Persist excluded (out-of-scope) rows ─────────────────────────────────
    // Runs BEFORE weekly_transactions insert so a later failure still leaves an
    // audit trail. ON CONFLICT (dedupe_hash) DO NOTHING handles re-imports.
    if (exclHash.length > 0) {
      console.log('[confirm] step 4.5 START: bulk INSERT excluded_transactions, count=', exclHash.length);
      await sql`
        INSERT INTO excluded_transactions (
          source_file, week_ending, date_booked, basic_account_no, division,
          description, account_description, debit, credit,
          journal_no, audit_number, transaction_no, job_no, vendor_no, dedupe_hash
        )
        SELECT * FROM UNNEST(
          ${exclSrc}::text[],
          ${exclWeek}::date[],
          ${exclDate}::date[],
          ${exclAcct}::text[],
          ${exclDiv}::text[],
          ${exclDesc}::text[],
          ${exclAcctDesc}::text[],
          ${exclDr}::numeric[],
          ${exclCr}::numeric[],
          ${exclJournal}::text[],
          ${exclAudit}::text[],
          ${exclTrxNo}::text[],
          ${exclJob}::text[],
          ${exclVendor}::text[],
          ${exclHash}::text[]
        )
        ON CONFLICT (dedupe_hash) DO NOTHING
      `;
      console.log('[confirm] step 4.5 DONE');
    }

    if (txWeekEndings.length > 0) {
      console.log('[confirm] step 5 START: bulk INSERT weekly_transactions, count=', txWeekEndings.length);
      await sql`
        INSERT INTO weekly_transactions (
          week_ending, gl_account_id, basic_account_no, division,
          date_booked, audit_number, job_no, description,
          debit, credit, vendor_no, dedupe_hash
        )
        SELECT * FROM UNNEST(
          ${txWeekEndings}::date[],
          ${txGlIds}::int[],
          ${txBasicAccountNos}::int[],
          ${txDivisions}::text[],
          ${txDateBookeds}::date[],
          ${txAuditNumbers}::text[],
          ${txJobNos}::text[],
          ${txDescriptions}::text[],
          ${txDebits}::numeric[],
          ${txCredits}::numeric[],
          ${txVendorNos}::text[],
          ${txHashes}::text[]
        )
      `;
      console.log('[confirm] step 5 DONE');
    }

    // ── Batch-load existing beg_balances for all (week, glId) pairs ──────────
    const existingBalMap = new Map<string, number>();
    if (buckets.size > 0) {
      const balWeekEndings: string[] = [];
      const balGlIds: number[] = [];
      for (const b of buckets.values()) {
        balWeekEndings.push(b.weekEnding);
        balGlIds.push(b.glId);
      }
      console.log('[confirm] step 6 START: existingBal lookup for', buckets.size, 'buckets');
      const existingRows = await sql`
        SELECT week_ending::text AS week_ending, gl_account_id, beg_balance
        FROM weekly_balances
        WHERE (week_ending, gl_account_id) IN (
          SELECT * FROM UNNEST(${balWeekEndings}::date[], ${balGlIds}::int[])
        )
      `;
      console.log('[confirm] step 6 DONE:', existingRows.length, 'existing balance rows');
      for (const r of existingRows) {
        const key = `${String(r.week_ending)}|${Number(r.gl_account_id)}`;
        existingBalMap.set(key, parseFloat(String(r.beg_balance)));
      }
    }

    // ── Per-week chain: for each affected week in ascending date order, ─────
    //    (a) look up prior week's end_balance JIT from the DB (includes any
    //        weeks we just swept earlier in this loop), (b) upsert this
    //        week's balances, (c) run the sweep for this week alone so the
    //        next iteration can read a correct end_balance.
    const weeksArr = Array.from(affectedWeeks).sort();
    for (const weekISO of weeksArr) {
      // (a) JIT prior-week lookup
      const priorEndMap = new Map<number, number>();
      console.log('[confirm] week', weekISO, 'step a START: prior week lookup');
      const priorRows = await sql`
        SELECT week_ending::text FROM weeks
        WHERE week_ending < ${weekISO}::date
        ORDER BY week_ending DESC LIMIT 1
      `;
      if (priorRows.length > 0) {
        const priorWeek = String(priorRows[0].week_ending);
        const balRows = await sql`
          SELECT gl_account_id, end_balance FROM weekly_balances
          WHERE week_ending = ${priorWeek}::date
        `;
        for (const r of balRows) {
          priorEndMap.set(Number(r.gl_account_id), parseFloat(String(r.end_balance)));
        }
        console.log('[confirm] week', weekISO, 'step a DONE: prior week =', priorWeek, ', balRows =', balRows.length);
      } else {
        console.log('[confirm] week', weekISO, 'step a DONE: no prior week');
      }

      // (b) filter buckets for this week, compute beg/end per bucket
      const weekBuckets = [...buckets.values()].filter(b => b.weekEnding === weekISO);

      // Carry-forward: any account with non-zero prior end_balance but no
      // CSV activity this week needs a synthetic zero-activity bucket so a
      // weekly_balances row is written for it. Without this, the next week
      // would read no row and chain from $0, dropping the running balance.
      // normal_balance value is unused for zero activity (debits=credits=0
      // makes both CASE branches yield begBalance unchanged).
      //
      // Safety guard: skip accounts that ALREADY have a weekly_balances row
      // for this week from a prior confirm run. Without this, a re-import
      // whose CSV rows all dedupe out would produce buckets.size === 0 for
      // the week, and every non-zero prior-end account would get a synthetic
      // (0,0) bucket whose UPSERT would clobber the real period_debit /
      // period_credit via ON CONFLICT DO UPDATE.
      const existingRowsForWeek = await sql`
        SELECT gl_account_id FROM weekly_balances
        WHERE week_ending = ${weekISO}::date
      `;
      const existingGlIdsForWeek = new Set<number>(
        existingRowsForWeek.map(r => Number(r.gl_account_id))
      );

      const glIdsInWeek = new Set(weekBuckets.map(b => b.glId));
      let carryForwardCount = 0;
      for (const [glId, priorEnd] of priorEndMap) {
        if (priorEnd === 0) continue;
        if (glIdsInWeek.has(glId)) continue;
        if (existingGlIdsForWeek.has(glId)) continue;
        weekBuckets.push({
          weekEnding: weekISO,
          glId,
          normalBalance: '',
          debits: 0,
          credits: 0,
          rowsToInsert: [],
        });
        carryForwardCount++;
      }
      if (carryForwardCount > 0) {
        console.log('[confirm] week', weekISO, 'carry-forward synthetic buckets:', carryForwardCount);
      }

      const balWeekArr: string[] = [];
      const balGlIdArr: number[] = [];
      const balBegArr: number[] = [];
      const balEndArr: number[] = [];
      const balDrArr: number[] = [];
      const balCrArr: number[] = [];

      for (const bucket of weekBuckets) {
        const priorEnd = priorEndMap.get(bucket.glId) ?? 0;
        const existingKey = `${bucket.weekEnding}|${bucket.glId}`;
        const begBalance = existingBalMap.has(existingKey)
          ? existingBalMap.get(existingKey)!
          : priorEnd;
        const endBalance = bucket.normalBalance === "debit"
          ? begBalance + bucket.debits - bucket.credits
          : begBalance - bucket.debits + bucket.credits;

        balWeekArr.push(bucket.weekEnding);
        balGlIdArr.push(bucket.glId);
        balBegArr.push(begBalance);
        balEndArr.push(endBalance);
        balDrArr.push(bucket.debits);
        balCrArr.push(bucket.credits);
      }

      // (c) upsert this week's weekly_balances rows
      if (balWeekArr.length > 0) {
        console.log('[confirm] week', weekISO, 'step b START: upsert weekly_balances, count=', balWeekArr.length);
        await sql`
          INSERT INTO weekly_balances
            (week_ending, gl_account_id, beg_balance, end_balance, period_debit, period_credit)
          SELECT * FROM UNNEST(
            ${balWeekArr}::date[],
            ${balGlIdArr}::int[],
            ${balBegArr}::numeric[],
            ${balEndArr}::numeric[],
            ${balDrArr}::numeric[],
            ${balCrArr}::numeric[]
          )
          ON CONFLICT (week_ending, gl_account_id) DO UPDATE SET
            beg_balance   = EXCLUDED.beg_balance,
            period_debit  = EXCLUDED.period_debit,
            period_credit = EXCLUDED.period_credit
        `;
        console.log('[confirm] week', weekISO, 'step b DONE');
      }

      // (c2) Recompute period_debit / period_credit from the authoritative
      //      source: the SUM of weekly_transactions for this (week, account).
      //      This is what makes multi-import-to-same-week correct. The UPSERT
      //      above wrote per-run bucket sums (e.g. Feb run's $5M DR); this
      //      UPDATE replaces them with the true cumulative total across all
      //      imports that have touched this week (e.g. Jan's $13.2M + Feb's
      //      $5M = $18.2M).
      console.log('[confirm] week', weekISO, 'step c2 START: recompute period totals from tx SUM');
      await sql`
        UPDATE weekly_balances b
        SET period_debit  = COALESCE(tx.dr, 0),
            period_credit = COALESCE(tx.cr, 0)
        FROM (
          SELECT gl_account_id,
                 SUM(debit)  AS dr,
                 SUM(credit) AS cr
          FROM weekly_transactions
          WHERE week_ending = ${weekISO}::date
          GROUP BY gl_account_id
        ) tx
        WHERE b.week_ending = ${weekISO}::date
          AND b.gl_account_id = tx.gl_account_id
      `;
      console.log('[confirm] week', weekISO, 'step c2 DONE');

      // (d) sweep end_balance for THIS week so the next iteration sees
      //     a correct value when it reads this row as its "prior week".
      //     Uses the period totals recomputed in step c2 above.
      console.log('[confirm] week', weekISO, 'step c START: end_balance sweep (this week)');
      await sql`
        UPDATE weekly_balances b
        SET end_balance = b.beg_balance +
          CASE a.normal_balance
            WHEN 'debit'  THEN (b.period_debit - b.period_credit)
            WHEN 'credit' THEN (b.period_credit - b.period_debit)
          END
        FROM gl_accounts a
        WHERE b.gl_account_id = a.id
          AND b.week_ending = ${weekISO}::date
      `;
      console.log('[confirm] week', weekISO, 'step c DONE');
    }

    // ── Mark affected weeks as confirmed ─────────────────────────────────────
    if (weeksArr.length > 0) {
      console.log('[confirm] step 9 START: weeks UPDATE');
      await sql`
        UPDATE weeks SET is_confirmed = true, confirmed_at = NOW()
        WHERE week_ending = ANY(${weeksArr}::date[])
      `;
      console.log('[confirm] step 9 DONE');
    }

    // ── Log to import_log ─────────────────────────────────────────────────────
    const rowsTotal = rowsImported + rowsDuplicate + rowsOutOfScope;
    const status = "confirmed";
    const weeksTouched = Array.from(affectedWeeks).sort();

    console.log('[confirm] step 10 START: import_log INSERT');
    await sql`
      INSERT INTO import_log
        (filename, imported_at, weeks_touched, rows_total, rows_imported,
         rows_out_of_scope, rows_duplicate, status)
      VALUES (
        ${filename},
        NOW(),
        ${weeksTouched}::date[],
        ${rowsTotal},
        ${rowsImported},
        ${rowsOutOfScope},
        ${rowsDuplicate},
        ${status}
      )
    `;
    console.log('[confirm] step 10 DONE');

    // ── Cleanup staging ───────────────────────────────────────────────────────
    console.log('[confirm] step 11 START: delete staging');
    await sql`DELETE FROM import_staging WHERE session_id = ${sessionId}`;
    console.log('[confirm] step 11 DONE');

    console.log('[confirm] done');

    return NextResponse.json({
      success: true,
      rowsImported,
      rowsSkipped: rowsDuplicate + rowsOutOfScope,
      rowsDuplicate,
      rowsOutOfScope,
      weeksCommitted: weeksTouched,
    });
  } catch (error: any) {
    const errorInfo = {
      message: error?.message,
      code: error?.code,
      detail: error?.detail,
      hint: error?.hint,
      where: error?.where,
      table: error?.table,
      column: error?.column,
      constraint: error?.constraint,
      sourceError: error?.sourceError?.message,
      stack: error?.stack?.split('\n').slice(0,5).join(' | '),
    };
    console.error('CONFIRM_ERROR', JSON.stringify(errorInfo));
    return NextResponse.json({ error: 'confirm_failed', debug: errorInfo }, { status: 500 });
  }
}
