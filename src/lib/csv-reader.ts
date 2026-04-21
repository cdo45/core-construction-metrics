import Papa from "papaparse";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NormalizedRow {
  basicAccountNo: number;
  jobNo: string;
  dateBooked: Date;
  journalNo: string;
  transactionNo: string;
  lineNo: number;
  fullAccountNo: string;
  debit: number;
  credit: number;
  description: string;
  vendorNo: string;
  auditNumber: string;
  division: string;
  accountsDescription: string;
  vendorCustomerName: string;
}

// ─── Column indices (0-based) ─────────────────────────────────────────────────

const COL = {
  basicAccountNo:       3,
  jobNo:                4,
  dateBooked:           5,
  journalNo:            6,
  transactionNo:        7,
  lineNo:               8,
  fullAccountNo:        9,
  debit:               10,
  credit:              11,
  description:         14,
  vendorNo:            16,
  auditNumber:         19,
  division:            23,
  accountsDescription: 36,
  vendorCustomerName:  41,
} as const;

const REQUIRED_COLUMN_COUNT = 49;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDate(raw: string): Date | null {
  if (!raw || !raw.trim()) return null;
  // MM/DD/YYYY
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
  return isNaN(d.getTime()) ? null : d;
}

function parseMoney(raw: string): number {
  if (!raw || !raw.trim()) return 0;
  const cleaned = raw.replace(/[$,\s]/g, "");
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

function col(row: string[], idx: number): string {
  return (row[idx] ?? "").trim();
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parseFoundationCsv(fileBuffer: Buffer): NormalizedRow[] {
  const text = fileBuffer.toString("utf8");

  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: true,
    header: false,
  });

  const rawRows = result.data as string[][];
  if (rawRows.length === 0) return [];

  // Validate header column count
  const header = rawRows[0];
  if (header.length < REQUIRED_COLUMN_COUNT) {
    throw new Error(
      `Invalid Foundation CSV: expected ≥${REQUIRED_COLUMN_COUNT} columns, got ${header.length}`
    );
  }

  const normalized: NormalizedRow[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (row.length < REQUIRED_COLUMN_COUNT) continue;

    const rawDate = col(row, COL.dateBooked);
    const dateBooked = parseDate(rawDate);
    if (!dateBooked) continue; // skip rows without a valid date

    const basicAccountNo = parseInt(col(row, COL.basicAccountNo), 10);
    if (!isFinite(basicAccountNo) || basicAccountNo <= 0) continue;

    normalized.push({
      basicAccountNo,
      jobNo:               col(row, COL.jobNo),
      dateBooked,
      journalNo:           col(row, COL.journalNo),
      transactionNo:       col(row, COL.transactionNo),
      lineNo:              parseInt(col(row, COL.lineNo), 10) || 0,
      fullAccountNo:       col(row, COL.fullAccountNo),
      debit:               parseMoney(col(row, COL.debit)),
      credit:              parseMoney(col(row, COL.credit)),
      description:         col(row, COL.description),
      vendorNo:            col(row, COL.vendorNo),
      auditNumber:         col(row, COL.auditNumber),
      division:            col(row, COL.division),
      accountsDescription: col(row, COL.accountsDescription),
      vendorCustomerName:  col(row, COL.vendorCustomerName),
    });
  }

  return normalized;
}
