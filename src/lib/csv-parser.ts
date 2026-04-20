// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedTransaction {
  account_no:     number;
  full_account_no: string;
  trx_date:       string | null;
  journal:        string;
  audit_no:       string;
  gl_trx_no:      string;
  line:           string;
  job:            string;
  description:    string;
  debit:          number;
  credit:         number;
  vendor_cust_no: string;
  trx_no:         string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const SKIP_PATTERNS = [
  "Account Totals:",
  "Beginning Balance:",
  "Current Period:",
  "Ending Balance:",
];

// Expected Foundation GL Activity export headers, normalized
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

export function parseCSV(text: string): ParsedTransaction[] {
  const lines = text.split(/\r?\n/);
  const results: ParsedTransaction[] = [];

  // Skip header row (index 0)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVLine(line).map((c) => c.trim());
    if (cols.length < 14) continue;

    const description = cols[9];

    if (SKIP_PATTERNS.some((p) => description.includes(p))) continue;

    const account_no = parseInt(cols[0].replace(/\D/g, ""), 10);
    if (isNaN(account_no) || account_no === 0) continue;

    const debit  = parseMoney(cols[10]);
    const credit = parseMoney(cols[11]);

    const trx_date_raw = cols[3].trim();
    if (!trx_date_raw && debit === 0 && credit === 0) continue;

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

    results.push({
      account_no,
      full_account_no: cols[2].trim(),
      trx_date,
      journal:        cols[4].trim(),
      audit_no:       cols[5].trim(),
      gl_trx_no:      cols[6].trim(),
      line:           cols[7].trim(),
      job:            cols[8].trim(),
      description,
      debit,
      credit,
      vendor_cust_no: cols[12].trim(),
      trx_no:         cols[13].trim(),
    });
  }

  return results;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/**
 * Validate that row 0 of the CSV looks like a Foundation GL Activity export.
 * Returns null if headers match (or drift by ≤2 columns).
 * Returns an error string if 3+ columns mismatch or the row is too short.
 */
export function validateFoundationHeaders(row0cols: string[]): string | null {
  if (row0cols.length < 14) {
    return `Not a Foundation GL export (expected 14 columns, got ${row0cols.length})`;
  }

  const mismatches = EXPECTED_HEADERS.reduce((count, expected, i) => {
    return normalizeHeader(row0cols[i]) === expected ? count : count + 1;
  }, 0);

  if (mismatches >= 3) {
    return "Not a Foundation GL export (header mismatch)";
  }

  return null;
}

/**
 * Return the fraction (0–1) of transactions whose full_account_no ends with "99".
 * Returns 0 for an empty array.
 */
export function detectDivision99Percentage(transactions: ParsedTransaction[]): number {
  if (transactions.length === 0) return 0;
  const count = transactions.filter((t) => t.full_account_no.trim().endsWith("99")).length;
  return count / transactions.length;
}
