import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/gl-accounts/[id]
// Body must include: description, normal_balance, category_id (null ok), is_active
// account_no is optional — only updated when no weekly_balances reference this account
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const sql = getDb();
    const { id } = await ctx.params;
    const glId = parseInt(id, 10);
    if (!glId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await req.json();
    const { account_no, description, normal_balance, category_id, is_active } = body;

    if (!description || String(description).trim() === "") {
      return NextResponse.json({ error: "description is required" }, { status: 400 });
    }
    if (normal_balance !== "debit" && normal_balance !== "credit") {
      return NextResponse.json(
        { error: "normal_balance must be 'debit' or 'credit'" },
        { status: 400 }
      );
    }

    // Check balance history before allowing account_no change
    if (account_no !== undefined) {
      const [{ count }] = await sql`
        SELECT COUNT(*)::int AS count FROM weekly_balances WHERE gl_account_id = ${glId}
      `;
      if (count > 0) {
        return NextResponse.json(
          {
            error: `Account # locked — ${count} week${count === 1 ? "" : "s"} of data reference this account.`,
          },
          { status: 409 }
        );
      }
      const [updated] = await sql`
        UPDATE gl_accounts
        SET account_no     = ${account_no},
            description    = ${String(description).trim()},
            normal_balance = ${normal_balance},
            category_id    = ${category_id ?? null},
            is_active      = ${is_active ?? true}
        WHERE id = ${glId}
        RETURNING id, account_no, description, normal_balance, category_id, is_active
      `;
      if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(updated);
    }

    // No account_no change — update everything else
    const [updated] = await sql`
      UPDATE gl_accounts
      SET description    = ${String(description).trim()},
          normal_balance = ${normal_balance},
          category_id    = ${category_id ?? null},
          is_active      = ${is_active ?? true}
      WHERE id = ${glId}
      RETURNING id, account_no, description, normal_balance, category_id, is_active
    `;

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    console.error("PATCH /api/gl-accounts/[id] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE /api/gl-accounts/[id] — blocked if weekly_balances rows exist
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const sql = getDb();
    const { id } = await ctx.params;
    const glId = parseInt(id, 10);
    if (!glId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count FROM weekly_balances WHERE gl_account_id = ${glId}
    `;

    if (count > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete — ${count} week${count === 1 ? "" : "s"} of historical data reference this account. Deactivate instead.`,
        },
        { status: 409 }
      );
    }

    await sql`DELETE FROM gl_accounts WHERE id = ${glId}`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/gl-accounts/[id] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
