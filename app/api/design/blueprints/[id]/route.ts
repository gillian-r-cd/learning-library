import { NextRequest, NextResponse } from "next/server";
import { getBlueprint, deleteBlueprint } from "@/lib/blueprint";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bp = getBlueprint(id);
  if (!bp) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ blueprint: bp });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!getBlueprint(id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const counts = deleteBlueprint(id);
  return NextResponse.json({ ok: true, deleted: counts });
}
