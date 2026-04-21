import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const VALID_ACCOUNT_TYPES = [
  "balance", "revenue", "labor", "materials",
  "subs", "equipment", "overhead", "other",
] as const;

type AccountType = typeof VALID_ACCOUNT_TYPES[number];

export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const body = await req.json() as {
      accountNo: unknown;
      division: unknown;
      description: unknown;
      normalBalance: unknown;
      accountType: unknown;
      categoryId: unknown;
    };

    const { accountNo, division, description, normalBalance, accountType, categoryId } = body;

    // ── Validate ──────────────────────────────────────────────────────────────
    if (!accountNo || typeof accountNo !== "number" || !isFinite(accountNo)) {
      return NextResponse.json({ error: "accountNo (number) is required" }, { status: 400 });
    }
    if (typeof division !== "string") {
      return NextResponse.json({ error: "division (string) is required" }, { status: 400 });
    }
    if (!description || typeof description !== "string" || description.trim() === "") {
      return NextResponse.json({ error: "description is required" }, { status: 400 });
    }
    if (normalBalance !== "debit" && normalBalance !== "credit") {
      return NextResponse.json(
        { error: "normalBalance must be 'debit' or 'credit'" },
        { status: 400 }
      );
    }
    if (!VALID_ACCOUNT_TYPES.includes(accountType as AccountType)) {
      return NextResponse.json(
        { error: `accountType must be one of: ${VALID_ACCOUNT_TYPES.join(", ")}` },
        { status: 400 }
      );
    }
    if (!categoryId || typeof categoryId !== "number") {
      return NextResponse.json({ error: "categoryId (number) is required" }, { status: 400 });
    }

    // ── Check for existing (accountNo, division) ──────────────────────────────
    const existing = await sql`
      SELECT id, account_no, description, division
      FROM gl_accounts
      WHERE account_no = ${accountNo} AND division = ${division}
      LIMIT 1
    `;
    if (existing.length > 0) {
      return NextResponse.json(
        {
          error: `Account ${accountNo} / division "${division}" already exists (id=${existing[0].id}).`,
          existing: existing[0],
        },
        { status: 409 }
      );
    }

    // ── Insert ────────────────────────────────────────────────────────────────
    const [created] = await sql`
      INSERT INTO gl_accounts
        (account_no, division, description, normal_balance, account_type, category_id, is_active)
      VALUES
        (${accountNo}, ${division}, ${description.trim()}, ${normalBalance as string},
         ${accountType as string}, ${categoryId}, true)
      RETURNING id, account_no, division, description, normal_balance, account_type,
                category_id, is_active
    `;

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("POST /api/gl-accounts/quick-add error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
