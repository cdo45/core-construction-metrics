import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const key = new URL(req.url).searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT key, value FROM app_settings WHERE key = ${key}
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ key: rows[0].key as string, value: rows[0].value as string });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as { key?: string; value?: unknown };
    const { key, value } = body;
    if (!key || value === undefined || value === null) {
      return NextResponse.json({ error: "key and value are required" }, { status: 400 });
    }
    const sql = getDb();
    await sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${key}, ${String(value)}, NOW())
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            updated_at = NOW()
    `;
    return NextResponse.json({ key, value: String(value) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
