import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/gl-accounts — list all GL accounts with category name and balance_count joined
export async function GET() {
  try {
    const sql = getDb();
    const accounts = await sql`
      SELECT
        g.id,
        g.account_no,
        g.description,
        g.normal_balance,
        g.category_id,
        c.name  AS category_name,
        c.color AS category_color,
        g.is_active,
        g.created_at,
        COUNT(wb.id)::int AS balance_count
      FROM gl_accounts g
      LEFT JOIN categories c ON c.id = g.category_id
      LEFT JOIN weekly_balances wb ON wb.gl_account_id = g.id
      GROUP BY g.id, c.name, c.color
      ORDER BY g.account_no ASC
    `;
    return NextResponse.json(accounts);
  } catch (err) {
    console.error("GET /api/gl-accounts error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/gl-accounts — create a new GL account
// Body: { account_no, description, normal_balance, category_id?, is_active? }
export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const body = await req.json();
    const {
      account_no,
      description,
      normal_balance,
      category_id = null,
      is_active = true,
    } = body;

    if (!account_no || typeof account_no !== "number") {
      return NextResponse.json(
        { error: "account_no (number) is required" },
        { status: 400 }
      );
    }
    if (!description || typeof description !== "string" || description.trim() === "") {
      return NextResponse.json({ error: "description is required" }, { status: 400 });
    }
    if (normal_balance !== "debit" && normal_balance !== "credit") {
      return NextResponse.json(
        { error: "normal_balance must be 'debit' or 'credit'" },
        { status: 400 }
      );
    }

    const [account] = await sql`
      INSERT INTO gl_accounts (account_no, description, normal_balance, category_id, is_active)
      VALUES (${account_no}, ${description.trim()}, ${normal_balance}, ${category_id}, ${is_active})
      RETURNING id, account_no, description, normal_balance, category_id, is_active, created_at
    `;

    return NextResponse.json(account, { status: 201 });
  } catch (err) {
    console.error("POST /api/gl-accounts error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PUT /api/gl-accounts — update category assignment, description, or active state
// Body: { id, category_id?, description?, is_active?, normal_balance? }
export async function PUT(req: NextRequest) {
  try {
    const sql = getDb();
    const body = await req.json();
    const { id, category_id, description, is_active, normal_balance } = body;

    if (!id || typeof id !== "number") {
      return NextResponse.json({ error: "id (number) is required" }, { status: 400 });
    }

    // Build update dynamically — only update provided fields
    const updates: string[] = [];
    const values: unknown[] = [];

    if (category_id !== undefined) {
      updates.push(`category_id = $${updates.length + 1}`);
      values.push(category_id);
    }
    if (description !== undefined) {
      updates.push(`description = $${updates.length + 1}`);
      values.push(description);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${updates.length + 1}`);
      values.push(is_active);
    }
    if (normal_balance !== undefined) {
      if (normal_balance !== "debit" && normal_balance !== "credit") {
        return NextResponse.json(
          { error: "normal_balance must be 'debit' or 'credit'" },
          { status: 400 }
        );
      }
      updates.push(`normal_balance = $${updates.length + 1}`);
      values.push(normal_balance);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    values.push(id);
    const query = `
      UPDATE gl_accounts
      SET ${updates.join(", ")}
      WHERE id = $${values.length}
      RETURNING id, account_no, description, normal_balance, category_id, is_active, created_at
    `;

    // neon tagged-template function also accepts (queryString, paramsArray)
    const rows = await sql(query, values as never[]);
    if (rows.length === 0) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error("PUT /api/gl-accounts error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
