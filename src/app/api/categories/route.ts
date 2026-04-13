import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/categories — list all categories ordered by sort_order
export async function GET() {
  try {
    const sql = getDb();
    const categories = await sql`
      SELECT id, name, sort_order, color, created_at
      FROM categories
      ORDER BY sort_order ASC, id ASC
    `;
    return NextResponse.json(categories);
  } catch (err) {
    console.error("GET /api/categories error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/categories — create a new category
// Body: { name: string, sort_order?: number, color?: string }
export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const body = await req.json();
    const { name, sort_order = 0, color = "#000000" } = body;

    if (!name || typeof name !== "string" || name.trim() === "") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const [category] = await sql`
      INSERT INTO categories (name, sort_order, color)
      VALUES (${name.trim()}, ${sort_order}, ${color})
      RETURNING id, name, sort_order, color, created_at
    `;

    return NextResponse.json(category, { status: 201 });
  } catch (err) {
    console.error("POST /api/categories error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
