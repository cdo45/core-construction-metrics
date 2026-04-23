import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/gl-accounts/[id]/category
// Body: { category_id: number | null }
// Narrow endpoint for the setup page's inline category editor.
// Leaves every other field on gl_accounts untouched.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const sql = getDb();
    const { id } = await ctx.params;
    const glId = parseInt(id, 10);
    if (!Number.isFinite(glId) || glId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as
      | { category_id?: number | null }
      | null;
    if (body === null) {
      return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
    }
    const rawCatId = body.category_id;
    const catId =
      rawCatId === null
        ? null
        : typeof rawCatId === "number" && Number.isFinite(rawCatId)
        ? rawCatId
        : NaN;
    if (Number.isNaN(catId)) {
      return NextResponse.json(
        { error: "category_id must be a number or null" },
        { status: 400 }
      );
    }

    if (catId !== null) {
      const exists = await sql`SELECT id FROM categories WHERE id = ${catId} LIMIT 1`;
      if (exists.length === 0) {
        return NextResponse.json(
          { error: `category_id ${catId} does not exist` },
          { status: 400 }
        );
      }
    }

    const rows = await sql`
      UPDATE gl_accounts
      SET category_id = ${catId}
      WHERE id = ${glId}
      RETURNING id, account_no, division, description, normal_balance,
                category_id, is_active
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Return updated row with category name JOINed, per spec.
    const joined = await sql`
      SELECT g.id, g.account_no, g.division, g.description, g.normal_balance,
             g.category_id, g.is_active,
             c.name AS category_name, c.color AS category_color
      FROM gl_accounts g
      LEFT JOIN categories c ON c.id = g.category_id
      WHERE g.id = ${glId}
      LIMIT 1
    `;
    return NextResponse.json(joined[0] ?? rows[0]);
  } catch (err) {
    console.error("PATCH /api/gl-accounts/[id]/category error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
