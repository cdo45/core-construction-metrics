import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/gl-accounts/[id]/allocation
// Body: { is_allocation: boolean }
// is_allocation is a sub-classification of is_non_cash — setting it true
// on a row that isn't non-cash would quietly drop into the "allocation"
// bucket in pnl-breakdown but never render (the UI only branches when
// is_non_cash is true). Enforced here so the data stays clean: attempting
// to set is_allocation=true on a cash row returns 409.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const sql = getDb();
    const { id } = await ctx.params;
    const glId = parseInt(id, 10);
    if (!glId || glId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = (await req.json()) as { is_allocation?: unknown };
    if (typeof body.is_allocation !== "boolean") {
      return NextResponse.json(
        { error: "is_allocation (boolean) is required" },
        { status: 400 }
      );
    }

    // Guard: only allow true when the underlying row is already non-cash.
    // Setting back to false is always fine.
    if (body.is_allocation === true) {
      const [row] = await sql`
        SELECT is_non_cash FROM gl_accounts WHERE id = ${glId} LIMIT 1
      `;
      if (!row) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (!row.is_non_cash) {
        return NextResponse.json(
          { error: "Account must be flagged is_non_cash before marking as allocation." },
          { status: 409 }
        );
      }
    }

    const [updated] = await sql`
      UPDATE gl_accounts
      SET is_allocation = ${body.is_allocation}
      WHERE id = ${glId}
      RETURNING id, account_no, is_non_cash, is_allocation
    `;

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: Number(updated.id),
      account_no: Number(updated.account_no),
      is_non_cash: Boolean(updated.is_non_cash),
      is_allocation: Boolean(updated.is_allocation),
    });
  } catch (err) {
    console.error("PATCH /api/gl-accounts/[id]/allocation error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
