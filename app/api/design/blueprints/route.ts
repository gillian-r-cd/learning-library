import { NextRequest, NextResponse } from "next/server";
import { createBlueprint, listBlueprints } from "@/lib/blueprint";

export async function GET() {
  return NextResponse.json({ blueprints: listBlueprints() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const topic = body?.topic as string;
  const designerId = (body?.designer_id as string) ?? "d_default";
  if (!topic) return NextResponse.json({ error: "topic required" }, { status: 400 });
  const bp = createBlueprint(topic, designerId);
  return NextResponse.json({ blueprint: bp });
}
