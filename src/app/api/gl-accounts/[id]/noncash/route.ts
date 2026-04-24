import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/gl-accounts/[id]/noncash
// Body: { is_non_cash: boolean }
// Narrow endpoint — mirrors .../category/ — flips only the is_non_cash
// flag. Keeps the CategoryEditor row toggle one round-trip with no other
// fields going over the wire.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const sql = getDb();
    const { id } = await ctx.params;
    const glId = parseInt(id, 10);
    if (!glId || glId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = (await req.json()) as { is_non_cash?: unknown };
    if (typeof body.is_non_cash !== "boolean") {
      return NextResponse.json(
        { error: "is_non_cash (boolean) is required" },
        { status: 400 }
      );
    }

    // Data-integrity invariant: is_allocation is a sub-flag of is_non_cash.
    // When the user un-flags is_non_cash, drop is_allocation too so a stale
    // allocation=true can't linger on a row that's no longer non-cash.
    const [updated] = body.is_non_cash
      ? await sql`
          UPDATE gl_accounts
          SET is_non_cash = true
          WHERE id = ${glId}
          RETURNING id, account_no, is_non_cash, is_allocation
        `
      : await sql`
          UPDATE gl_accounts
          SET is_non_cash = false,
              is_allocation = false
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
    console.error("PATCH /api/gl-accounts/[id]/noncash error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
