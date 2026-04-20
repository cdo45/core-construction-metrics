// Trial Balance CSV parser for the Foundation GL export format.
//
// Expected columns: Account No, Description, Debits, Credits, [ignored…]
// Account numbers can be 4-digit (balance-sheet) or 6-digit / "NNNN-DD" (P&L with division).

export interface ParsedTBRow {
  account_no:  number;
  division:    string;   // '' for 4-digit accounts, '10'/'20'/'99'/etc. for P&L
  raw_account: string;
  description: string;
  debit:       number;
  credit:      number;
}

export interface TBParseResult {
  rows:             ParsedTBRow[];
  total_debit:      number;
  total_credit:     number;
  balanced:         boolean;   // |debit - credit| <= 1.00
  footer_debit:     number;    // from "Total Trial Balance" footer row if present
  footer_credit:    number;
  skipped_count:    number;
}

// ─── CSV line splitter (handles quoted fields with embedded commas) ─────────

function splitLine(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
    } else if (c === "," && !inQ) {
      cols.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  cols.push(cur.trim());
  return cols;
}

// ─── Money cleaner ────────────────────────────────────────────────────────────

function parseMoney(raw: string): number {
  // Strip quotes, $, commas, leading/trailing spaces
  const s = raw.replace(/["$,\s]/g, "");
  // A bare dash (or multiple dashes) means zero
  if (!s || /^-+$/.test(s)) return 0;
  const v = parseFloat(s);
  return isFinite(v) ? Math.abs(v) : 0; // TB columns are unsigned
}

// ─── Account number parser ─────────────────────────────────────────────────

function parseAccount(raw: string): { account_no: number; division: string } | null {
  const s = raw.replace(/["'\s]/g, "");
  if (!s) return null;

  // "5101-10"  or  "5101-99"  (4-digit dash 2-digit)
  const m = s.match(/^(\d{4})-(\d{2,4})$/);
  if (m) return { account_no: parseInt(m[1], 10), division: m[2] };

  // "510110"  (6 digits, no dash)
  if (/^\d{6}$/.test(s)) {
    return { account_no: parseInt(s.slice(0, 4), 10), division: s.slice(4) };
  }

  // "1005"  (4 digits)
  if (/^\d{4}$/.test(s)) return { account_no: parseInt(s, 10), division: "" };

  return null;
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parseTBCsv(text: string): TBParseResult {
  const lines = text.split(/\r?\n/);
  const rows:  ParsedTBRow[] = [];
  let total_debit   = 0;
  let total_credit  = 0;
  let footer_debit  = 0;
  let footer_credit = 0;
  let skipped_count = 0;

  for (const line of lines) {
    if (!line.trim()) { skipped_count++; continue; }

    const cols = splitLine(line);
    if (cols.length < 4) { skipped_count++; continue; }

    const rawAcct = cols[0].replace(/"/g, "").trim();
    const desc    = cols[1].replace(/"/g, "").trim();
    const debStr  = cols[2];
    const credStr = cols[3];

    // Skip header row (first column is "Account No" / "Account")
    if (/^account\s*(no\.?)?$/i.test(rawAcct)) { skipped_count++; continue; }

    // Detect "Total Trial Balance" footer — may have empty account col
    if (/total\s+trial\s+balance/i.test(desc) || (!rawAcct && /total/i.test(desc))) {
      footer_debit  = parseMoney(debStr);
      footer_credit = parseMoney(credStr);
      skipped_count++;
      continue;
    }

    const parsed = parseAccount(rawAcct);
    if (!parsed) { skipped_count++; continue; }

    const debit  = parseMoney(debStr);
    const credit = parseMoney(credStr);

    rows.push({
      account_no:  parsed.account_no,
      division:    parsed.division,
      raw_account: rawAcct,
      description: desc,
      debit,
      credit,
    });
    total_debit  += debit;
    total_credit += credit;
  }

  // Prefer footer totals for balance check (they're the authoritative source)
  const checkD = footer_debit  || total_debit;
  const checkC = footer_credit || total_credit;

  return {
    rows,
    total_debit,
    total_credit,
    balanced:      Math.abs(checkD - checkC) <= 1.0,
    footer_debit,
    footer_credit,
    skipped_count,
  };
}
