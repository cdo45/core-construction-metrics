import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const WEEK_ENDING = "2024-12-31";

interface BsRow {
  account_no: number | null;
  description: string;
  amount: number;
}

interface SampleChange {
  gl_account_id: number;
  account_no: number;
  description: string;
  normal_balance: "debit" | "credit";
  before: number;
  after: number;
}

function parseMoney(raw: string): number {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  // Accounting negatives can appear as (1,234.56)
  const isParenNeg = /^\(.*\)$/.test(s);
  const cleaned = s.replace(/[$,()\s]/g, "");
  if (!cleaned) return 0;
  const n = parseFloat(cleaned);
  if (!isFinite(n)) return 0;
  return isParenNeg ? -n : n;
}

function findHeaderIdx(headers: string[], candidates: string[]): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const cands = candidates.map(norm);
  for (let i = 0; i < headers.length; i++) {
    const h = norm(headers[i] ?? "");
    if (cands.includes(h)) return i;
  }
  return -1;
}

function parseBsCsv(text: string): BsRow[] {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true, header: false });
  const rows = result.data as string[][];
  if (rows.length === 0) return [];

  // Find header row — scan first ~20 rows for one that looks like a header.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i].map((c) => (c ?? "").toString().toLowerCase());
    const hasDesc = r.some((c) => /description|account name|name/.test(c));
    const hasAmt = r.some((c) =>
      /amount|balance|ending|net|debit|credit|total/.test(c)
    );
    if (hasDesc && hasAmt) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) headerIdx = 0;

  const headers = rows[headerIdx].map((c) => (c ?? "").toString());
  const acctIdx = findHeaderIdx(headers, [
    "account_no",
    "account no",
    "account number",
    "acct no",
    "acct",
    "account",
  ]);
  const descIdx = findHeaderIdx(headers, [
    "description",
    "account description",
    "account name",
    "name",
  ]);
  const amtIdx = findHeaderIdx(headers, [
    "amount",
    "balance",
    "ending balance",
    "end balance",
    "net",
    "total",
    "current balance",
    "current",
  ]);
  const debitIdx = findHeaderIdx(headers, ["debit", "dr"]);
  const creditIdx = findHeaderIdx(headers, ["credit", "cr"]);

  if (descIdx < 0) {
    throw new Error(
      `BS CSV missing a description column. Headers: ${headers.join(", ")}`
    );
  }

  const out: BsRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const description = (row[descIdx] ?? "").toString().trim();
    if (!description) continue;

    const acctRaw = acctIdx >= 0 ? (row[acctIdx] ?? "").toString().trim() : "";
    const acctNum = acctRaw ? parseInt(acctRaw.replace(/[^0-9-]/g, ""), 10) : NaN;
    const account_no = isFinite(acctNum) && acctNum > 0 ? acctNum : null;

    let amount = 0;
    if (amtIdx >= 0) {
      amount = parseMoney((row[amtIdx] ?? "").toString());
    } else if (debitIdx >= 0 || creditIdx >= 0) {
      const dr = debitIdx >= 0 ? parseMoney((row[debitIdx] ?? "").toString()) : 0;
      const cr =
        creditIdx >= 0 ? parseMoney((row[creditIdx] ?? "").toString()) : 0;
      amount = dr - cr;
    } else {
      continue;
    }

    if (account_no === null && amount === 0) continue;

    out.push({ account_no, description, amount });
  }
  return out;
}

function normalizeDescription(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const body = (await req.json()) as { csv_text?: string };
    const csvText = body?.csv_text;
    if (!csvText || typeof csvText !== "string") {
      return NextResponse.json(
        { error: "csv_text (string) is required in body" },
        { status: 400 }
      );
    }

    let bsRows: BsRow[];
    try {
      bsRows = parseBsCsv(csvText);
    } catch (parseErr) {
      return NextResponse.json({ error: String(parseErr) }, { status: 422 });
    }

    if (bsRows.length === 0) {
      return NextResponse.json(
        { error: "No data rows found in BS CSV" },
        { status: 422 }
      );
    }

    // Load all gl_accounts for matching.
    const glRows = (await sql`
      SELECT id, account_no, description, normal_balance
      FROM gl_accounts
    `) as Array<{
      id: number;
      account_no: number;
      description: string;
      normal_balance: "debit" | "credit";
    }>;

    // Build lookup maps.
    const byAcctNo = new Map<number, typeof glRows[number]>();
    const byDesc = new Map<string, typeof glRows[number]>();
    const byDescAmbiguous = new Set<string>();
    for (const g of glRows) {
      byAcctNo.set(Number(g.account_no), g);
      const k = normalizeDescription(g.description);
      if (byDesc.has(k)) byDescAmbiguous.add(k);
      else byDesc.set(k, g);
    }

    let rows_updated = 0;
    const rows_unmatched: Array<{
      account_no: number | null;
      description: string;
      amount: number;
      reason: string;
    }> = [];
    const sample_changes: SampleChange[] = [];

    for (const r of bsRows) {
      let match: typeof glRows[number] | undefined;
      if (r.account_no != null) {
        match = byAcctNo.get(r.account_no);
      }
      if (!match) {
        const k = normalizeDescription(r.description);
        if (!byDescAmbiguous.has(k)) {
          match = byDesc.get(k);
        }
      }
      if (!match) {
        rows_unmatched.push({
          account_no: r.account_no,
          description: r.description,
          amount: r.amount,
          reason: r.account_no != null ? "no gl_account match" : "ambiguous or missing description match",
        });
        continue;
      }

      // Apply sign convention: assets (debit-normal) positive, liabilities
      // (credit-normal) negative in signed storage.
      const magnitude = Math.abs(r.amount);
      const signed =
        match.normal_balance === "debit" ? magnitude : -magnitude;

      // Capture before for sample.
      const beforeRows = (await sql`
        SELECT end_balance::numeric AS end_balance
        FROM weekly_balances
        WHERE week_ending = ${WEEK_ENDING}::date
          AND gl_account_id = ${match.id}
      `) as Array<{ end_balance: string }>;
      const before =
        beforeRows.length > 0 ? parseFloat(String(beforeRows[0].end_balance)) : 0;

      // Upsert the 12/31/24 row's end_balance. beg_balance for year-end is
      // intentionally left untouched (defaults to 0 on INSERT).
      await sql`
        INSERT INTO weekly_balances
          (week_ending, gl_account_id, beg_balance, end_balance)
        VALUES (${WEEK_ENDING}::date, ${match.id}, 0, ${signed})
        ON CONFLICT (week_ending, gl_account_id) DO UPDATE
          SET end_balance = EXCLUDED.end_balance
      `;

      rows_updated++;

      if (sample_changes.length < 10 && before !== signed) {
        sample_changes.push({
          gl_account_id: match.id,
          account_no: Number(match.account_no),
          description: match.description,
          normal_balance: match.normal_balance,
          before,
          after: signed,
        });
      }
    }

    return NextResponse.json({
      week_ending: WEEK_ENDING,
      rows_updated,
      rows_unmatched: rows_unmatched.length,
      unmatched_detail: rows_unmatched,
      sample_changes,
    });
  } catch (err) {
    console.error("/api/admin/reseed-yearend-2024 error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
