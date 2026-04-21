import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/categories/[id] — update name, sort_order, color
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const sql = getDb();
    const { id } = await ctx.params;
    const catId = parseInt(id, 10);
    if (!catId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const { name, sort_order, color } = await req.json();

    if (!name || typeof name !== "string" || name.trim() === "") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const [updated] = await sql`
      UPDATE categories
      SET name       = ${name.trim()},
          sort_order = ${sort_order ?? 0},
          color      = ${color ?? "#000000"}
      WHERE id = ${catId}
      RETURNING id, name, sort_order, color
    `;

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    console.error("PATCH /api/categories/[id] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE /api/categories/[id] — blocked if GL accounts reference it
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const sql = getDb();
    const { id } = await ctx.params;
    const catId = parseInt(id, 10);
    if (!catId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count FROM gl_accounts WHERE category_id = ${catId}
    `;

    if (count > 0) {
      return NextResponse.json(
        {
          error: `${count} account${count === 1 ? "" : "s"} still assigned to this category. Reassign or delete them first.`,
        },
        { status: 409 }
      );
    }

    await sql`DELETE FROM categories WHERE id = ${catId}`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/categories/[id] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
