// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedTransaction {
  account_no:      number;
  full_account_no: string;
  trx_date:        string | null;
  journal:         string;
  audit_no:        string;
  gl_trx_no:       string;
  line:            string;
  job:             string;
  description:     string;
  debit:           number;
  credit:          number;
  vendor_cust_no:  string;
  trx_no:          string;
}

export interface FilterStats {
  parsed:                  number; // total non-empty data rows (after header)
  skipped_subtotals:       number; // SKIP_PATTERNS matches
  skipped_blank_spacers:   number; // no date + zero activity rows
  skipped_bad_account:     number; // <14 cols or unparseable account_no
}

export interface ParseCSVResult {
  transactions: ParsedTransaction[];
  filter_stats: FilterStats;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const SKIP_PATTERNS = [
  "Account Totals:",
  "Beginning Balance:",
  "Current Period:",
  "Ending Balance:",
];

// Expected Foundation GL Activity export headers, normalised to lowercase + collapsed whitespace
const EXPECTED_HEADERS = [
  "account no",
  "account desc",
  "full account no",
  "trx date",
  "jrnl",
  "audit no",
  "g/l trx no",
  "line",
  "job",
  "description",
  "debit",
  "credit",
  "vnd / cust no",
  "trx no",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function parseMoney(raw: string): number {
  return parseFloat(raw.replace(/,/g, "").trim()) || 0;
}

function normalizeHeader(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// ─── Core parsers ─────────────────────────────────────────────────────────────

export function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let inQuote = false;
  let current = "";

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === "," && !inQuote) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export function parseCSV(text: string): ParseCSVResult {
  const lines = text.split(/\r?\n/);
  const transactions: ParsedTransaction[] = [];
  const filter_stats: FilterStats = {
    parsed:                0,
    skipped_subtotals:     0,
    skipped_blank_spacers: 0,
    skipped_bad_account:   0,
  };

  // Skip header row (index 0)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    filter_stats.parsed++;

    const cols = parseCSVLine(line).map((c) => c.trim());
    if (cols.length < 14) {
      filter_stats.skipped_bad_account++;
      continue;
    }

    const description = cols[9];

    if (SKIP_PATTERNS.some((p) => description.includes(p))) {
      filter_stats.skipped_subtotals++;
      continue;
    }

    const account_no = parseInt(cols[0].replace(/\D/g, ""), 10);
    if (isNaN(account_no) || account_no === 0) {
      filter_stats.skipped_bad_account++;
      continue;
    }

    const debit  = parseMoney(cols[10]);
    const credit = parseMoney(cols[11]);

    const trx_date_raw = cols[3].trim();
    if (!trx_date_raw && debit === 0 && credit === 0) {
      filter_stats.skipped_blank_spacers++;
      continue;
    }

    let trx_date: string | null = null;
    if (trx_date_raw) {
      const parts = trx_date_raw.split("/");
      if (parts.length === 3) {
        const [m, d, y] = parts;
        trx_date = `${y.padStart(4, "20")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      } else {
        trx_date = trx_date_raw;
      }
    }

    transactions.push({
      account_no,
      full_account_no: cols[2].trim(),
      trx_date,
      journal:         cols[4].trim(),
      audit_no:        cols[5].trim(),
      gl_trx_no:       cols[6].trim(),
      line:            cols[7].trim(),
      job:             cols[8].trim(),
      description,
      debit,
      credit,
      vendor_cust_no:  cols[12].trim(),
      trx_no:          cols[13].trim(),
    });
  }

  return { transactions, filter_stats };
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/**
 * Validate that the parsed header row looks like a Foundation GL Activity export.
 * Returns null when headers match or differ by ≤2 columns (allows minor format drift).
 * Returns an error string when 3+ columns mismatch or the row is too short.
 */
export function validateFoundationHeaders(row0cols: string[]): string | null {
  if (row0cols.length < 14) {
    return `Not a Foundation GL export (expected 14 columns, got ${row0cols.length})`;
  }

  let mismatches = 0;
  for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
    if (normalizeHeader(row0cols[i]) !== EXPECTED_HEADERS[i]) mismatches++;
  }

  return mismatches >= 3 ? "Not a Foundation GL export (header mismatch)" : null;
}

/**
 * Return the fraction (0–1) of transactions whose full_account_no ends with "99".
 * Returns 0 for an empty array.
 */
export function detectDivision99Percentage(
  transactions: { full_account_no: string }[],
): number {
  if (transactions.length === 0) return 0;
  const count = transactions.filter((t) =>
    t.full_account_no.trim().endsWith("99"),
  ).length;
  return count / transactions.length;
}
