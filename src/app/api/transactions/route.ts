import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransactionRow {
  id: number;
  date_booked: string | null;
  journal_no: string | null;
  audit_number: string | null;
  transaction_no: string | null;
  job_no: string | null;
  description: string | null;
  debit: number;
  credit: number;
  vendor_no: string | null;
}

export interface TransactionSummary {
  account_no: number;
  description: string;
  normal_balance: "debit" | "credit";
  beg_balance: number;
  end_balance: number;
  total_debits: number;
  total_credits: number;
  net_activity: number;
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

    // Look up GL account
    const acctRows = await sql`
      SELECT id, account_no, description, normal_balance
      FROM gl_accounts
      WHERE account_no = ${accountNo}
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

    // Fetch transactions
    const trxRows = await sql`
      SELECT
        id,
        date_booked::text,
        journal_no,
        audit_number,
        transaction_no,
        job_no,
        description,
        debit::numeric  AS debit,
        credit::numeric AS credit,
        vendor_no
      FROM weekly_transactions
      WHERE week_ending = ${weekEnding}
        AND gl_account_id = ${gl_account_id}
      ORDER BY date_booked NULLS LAST, transaction_no, id
    `;

    // Fetch balance for this week
    const balRows = await sql`
      SELECT beg_balance::numeric, end_balance::numeric
      FROM weekly_balances
      WHERE week_ending = ${weekEnding}
        AND gl_account_id = ${gl_account_id}
      LIMIT 1
    `;

    const beg_balance = balRows.length > 0 ? n(balRows[0].beg_balance) : 0;
    const end_balance = balRows.length > 0 ? n(balRows[0].end_balance) : 0;

    const transactions: TransactionRow[] = trxRows.map((r) => ({
      id:             Number(r.id),
      date_booked:    r.date_booked as string | null,
      journal_no:     r.journal_no as string | null,
      audit_number:   r.audit_number as string | null,
      transaction_no: r.transaction_no as string | null,
      job_no:         r.job_no as string | null,
      description:    r.description as string | null,
      debit:          n(r.debit),
      credit:         n(r.credit),
      vendor_no:      r.vendor_no as string | null,
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
    };

    const response: TransactionsResponse = { summary, transactions };
    return NextResponse.json(response);
  } catch (err) {
    console.error("GET /api/transactions error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
