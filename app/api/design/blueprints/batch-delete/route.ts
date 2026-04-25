import { NextRequest, NextResponse } from "next/server";
import { deleteBlueprints } from "@/lib/blueprint";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string") : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids required (array of blueprint_id)" }, { status: 400 });
  }
  const counts = deleteBlueprints(ids);
  return NextResponse.json({ ok: true, deleted: counts });
}
