import { NextRequest, NextResponse } from "next/server";
import { getBlueprint } from "@/lib/blueprint";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bp = getBlueprint(id);
  if (!bp) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ blueprint: bp });
}
