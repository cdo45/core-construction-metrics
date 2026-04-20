import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransactionRow {
  id: number;
  trx_date: string | null;
  journal: string | null;
  audit_no: string | null;
  gl_trx_no: string | null;
  line: string | null;
  job: string | null;
  description: string | null;
  debit: number;
  credit: number;
  vendor_cust_no: string | null;
  trx_no: string | null;
}

export interface TransactionSummary {
  account_no: number;
  description: string;
  normal_balance: "debit" | "credit";
  beg_balance: number | null;
  end_balance: number | null;
  total_debits: number;
  total_credits: number;
  net_activity: number;
  account_type: "overhead" | "balance_sheet";
}

export interface TransactionsResponse {
  summary: TransactionSummary;
  transactions: TransactionRow[];
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function n(v: unknown): number {
  const p = parseFloat(String(v));
  return isFinite(p) ? p : 0;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const weekEnding = searchParams.get("week_ending");
  const accountNoStr = searchParams.get("account_no");

  if (!weekEnding || !/^\d{4}-\d{2}-\d{2}$/.test(weekEnding)) {
    return NextResponse.json(
      { error: "week_ending (YYYY-MM-DD) is required" },
      { status: 400 }
    );
  }

  const accountNo = accountNoStr ? parseInt(accountNoStr, 10) : NaN;
  if (isNaN(accountNo)) {
    return NextResponse.json(
      { error: "account_no is required" },
      { status: 400 }
    );
  }

  try {
    const sql = getDb();

    // Look up GL account (include category name to detect overhead)
    const acctRows = await sql`
      SELECT ga.id, ga.account_no, ga.description, ga.normal_balance,
             c.name AS category_name
      FROM gl_accounts ga
      LEFT JOIN categories c ON c.id = ga.category_id
      WHERE ga.account_no = ${accountNo}
      LIMIT 1
    `;
    if (acctRows.length === 0) {
      return NextResponse.json(
        { error: `Account ${accountNo} not found` },
        { status: 404 }
      );
    }
    const acct = acctRows[0];
    const gl_account_id = Number(acct.id);
    const isOverhead = acct.category_name === "Overhead (Div 99)";

    // Fetch transactions
    const trxRows = await sql`
      SELECT
        id,
        trx_date::text,
        journal,
        audit_no,
        gl_trx_no,
        line,
        job,
        description,
        debit::numeric  AS debit,
        credit::numeric AS credit,
        vendor_cust_no,
        trx_no
      FROM weekly_transactions
      WHERE week_ending = ${weekEnding}
        AND gl_account_id = ${gl_account_id}
      ORDER BY trx_date NULLS LAST, gl_trx_no, id
    `;

    // Fetch balance for this week (overhead accounts have no weekly_balances entry)
    let beg_balance: number | null = null;
    let end_balance: number | null = null;
    if (!isOverhead) {
      const balRows = await sql`
        SELECT beg_balance::numeric, end_balance::numeric
        FROM weekly_balances
        WHERE week_ending = ${weekEnding}
          AND gl_account_id = ${gl_account_id}
        LIMIT 1
      `;
      beg_balance = balRows.length > 0 ? n(balRows[0].beg_balance) : 0;
      end_balance = balRows.length > 0 ? n(balRows[0].end_balance) : 0;
    }

    const transactions: TransactionRow[] = trxRows.map((r) => ({
      id:            Number(r.id),
      trx_date:      r.trx_date as string | null,
      journal:       r.journal as string | null,
      audit_no:      r.audit_no as string | null,
      gl_trx_no:     r.gl_trx_no as string | null,
      line:          r.line as string | null,
      job:           r.job as string | null,
      description:   r.description as string | null,
      debit:         n(r.debit),
      credit:        n(r.credit),
      vendor_cust_no: r.vendor_cust_no as string | null,
      trx_no:        r.trx_no as string | null,
    }));

    const total_debits  = transactions.reduce((s, t) => s + t.debit, 0);
    const total_credits = transactions.reduce((s, t) => s + t.credit, 0);
    const net_activity  =
      acct.normal_balance === "debit"
        ? total_debits - total_credits
        : total_credits - total_debits;

    const summary: TransactionSummary = {
      account_no:     Number(acct.account_no),
      description:    String(acct.description),
      normal_balance: acct.normal_balance as "debit" | "credit",
      beg_balance,
      end_balance,
      total_debits,
      total_credits,
      net_activity,
      account_type:   isOverhead ? "overhead" : "balance_sheet",
    };

    const response: TransactionsResponse = { summary, transactions };
    return NextResponse.json(response);
  } catch (err) {
    console.error("GET /api/transactions error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
