import { NormalizedRow } from "./csv-reader";
import { computeWeekEnding, buildDedupeHash } from "./week-math";
// ─── Types ────────────────────────────────────────────────────────────────────

export interface CategoryTotal {
  categoryName: string;
  periodDebit: number;
  periodCredit: number;
  netChange: number;
}

export interface WeekPreview {
  weekEnding: Date;
  isPartial: boolean;
  isNew: boolean;
  rowsNew: number;
  rowsDuplicate: number;
  categoryTotals: CategoryTotal[];
}

export interface OutOfScopeAccount {
  accountNo: number;
  division: string;
  description: string;
  rowCount: number;
}

export interface ImportPreview {
  filename: string;
  dateRange: { min: Date; max: Date };
  weeksAffected: WeekPreview[];
  outOfScope: {
    rowCount: number;
    uniqueAccounts: OutOfScopeAccount[];
  };
  errors: string[];
}

// ─── DB type ─────────────────────────────────────────────────────────────────

type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

// ─── Internal accumulators ────────────────────────────────────────────────────

interface WeekAccum {
  weekEnding: Date;
  isPartial: boolean;
  rowsNew: number;
  rowsDuplicate: number;
  // Map<"categoryName", { dr, cr }>
  cats: Map<string, { dr: number; cr: number }>;
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function buildImportPreview(
  filename: string,
  rows: NormalizedRow[],
  sql: Sql
): Promise<ImportPreview> {
  const errors: string[] = [];

  if (rows.length === 0) {
    return {
      filename,
      dateRange: { min: new Date(), max: new Date() },
      weeksAffected: [],
      outOfScope: { rowCount: 0, uniqueAccounts: [] },
      errors: ["No valid rows found in file."],
    };
  }

  // ── 1. Compute date range ─────────────────────────────────────────────────
  let minDate = rows[0].dateBooked;
  let maxDate = rows[0].dateBooked;
  for (const r of rows) {
    if (r.dateBooked < minDate) minDate = r.dateBooked;
    if (r.dateBooked > maxDate) maxDate = r.dateBooked;
  }

  // ── 2. Build GL account lookup: (account_no, division) → { id, categoryName } ──
  const uniqueKeys = new Set(rows.map((r) => `${r.basicAccountNo}|${r.division}`));
  const glLookup = new Map<string, { id: number; categoryName: string }>();

  for (const key of uniqueKeys) {
    const [acctStr, div] = key.split("|");
    const acctNo = parseInt(acctStr, 10);
    const dbRows = await sql`
      SELECT g.id, COALESCE(c.name, 'Uncategorized') AS category_name
      FROM gl_accounts g
      LEFT JOIN categories c ON c.id = g.category_id
      WHERE g.account_no = ${acctNo} AND g.division = ${div}
      LIMIT 1
    `;
    if (dbRows.length > 0) {
      glLookup.set(key, { id: Number(dbRows[0].id), categoryName: String(dbRows[0].category_name) });
    }
  }

  // ── 3. Load existing dedupe hashes from weekly_transactions ──────────────
  // Pull only for the date range we're importing to keep the set manageable
  const minISO = toISO(minDate);
  const maxISO = toISO(maxDate);
  const existingHashes = new Set<string>();
  const existingRows = await sql`
    SELECT dedupe_hash FROM weekly_transactions
    WHERE week_ending BETWEEN ${minISO}::date AND ${maxISO}::date
      AND dedupe_hash IS NOT NULL
  `;
  for (const r of existingRows) {
    if (r.dedupe_hash) existingHashes.add(String(r.dedupe_hash));
  }

  // ── 4. Check which weeks already have data ────────────────────────────────
  const existingWeeks = new Set<string>();
  const existingWeekRows = await sql`
    SELECT DISTINCT week_ending::text
    FROM weekly_balances
    WHERE week_ending BETWEEN ${minISO}::date AND ${maxISO}::date
  `;
  for (const r of existingWeekRows) existingWeeks.add(r.week_ending as string);

  // ── 5. Bucket rows ────────────────────────────────────────────────────────
  const weekAccums = new Map<string, WeekAccum>();
  const outOfScopeAccums = new Map<string, OutOfScopeAccount & { _total: number }>();
  let outOfScopeCount = 0;

  for (const row of rows) {
    const bounds = computeWeekEnding(row.dateBooked);
    const weekISO = toISO(bounds.weekEnding);
    const lookupKey = `${row.basicAccountNo}|${row.division}`;
    const glEntry = glLookup.get(lookupKey);

    if (!glEntry) {
      // Out of scope
      outOfScopeCount++;
      const oosKey = lookupKey;
      if (!outOfScopeAccums.has(oosKey)) {
        outOfScopeAccums.set(oosKey, {
          accountNo: row.basicAccountNo,
          division: row.division,
          description: row.accountsDescription || row.description,
          rowCount: 0,
          _total: 0,
        });
      }
      outOfScopeAccums.get(oosKey)!.rowCount++;
      continue;
    }

    // Dedupe check
    const hash = buildDedupeHash(
      weekISO,
      row.basicAccountNo,
      row.division,
      row.auditNumber,
      row.debit,
      row.credit
    );
    const isDuplicate = existingHashes.has(hash);

    if (!weekAccums.has(weekISO)) {
      weekAccums.set(weekISO, {
        weekEnding: bounds.weekEnding,
        isPartial: bounds.isPartial,
        rowsNew: 0,
        rowsDuplicate: 0,
        cats: new Map(),
      });
    }

    const wa = weekAccums.get(weekISO)!;
    if (isDuplicate) {
      wa.rowsDuplicate++;
    } else {
      wa.rowsNew++;
      const catKey = glEntry.categoryName;
      if (!wa.cats.has(catKey)) wa.cats.set(catKey, { dr: 0, cr: 0 });
      const cat = wa.cats.get(catKey)!;
      cat.dr += row.debit;
      cat.cr += row.credit;
    }
  }

  // ── 6. Assemble output ────────────────────────────────────────────────────
  const weeksAffected: WeekPreview[] = [];
  for (const [weekISO, wa] of Array.from(weekAccums).sort(([a], [b]) => a.localeCompare(b))) {
    const categoryTotals: CategoryTotal[] = [];
    for (const [catName, { dr, cr }] of wa.cats) {
      categoryTotals.push({
        categoryName: catName,
        periodDebit: dr,
        periodCredit: cr,
        netChange: dr - cr,
      });
    }
    weeksAffected.push({
      weekEnding: wa.weekEnding,
      isPartial: wa.isPartial,
      isNew: !existingWeeks.has(weekISO),
      rowsNew: wa.rowsNew,
      rowsDuplicate: wa.rowsDuplicate,
      categoryTotals,
    });
  }

  const uniqueAccounts: OutOfScopeAccount[] = Array.from(outOfScopeAccums.values()).map(
    ({ _total: _, ...rest }) => rest
  );

  return {
    filename,
    dateRange: { min: minDate, max: maxDate },
    weeksAffected,
    outOfScope: { rowCount: outOfScopeCount, uniqueAccounts },
    errors,
  };
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}
