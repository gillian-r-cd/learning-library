import { NextRequest, NextResponse } from "next/server";
import { copilotChat } from "@/lib/design-copilot";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { blueprint_id, message } = body ?? {};
  if (!blueprint_id || !message) {
    return NextResponse.json({ error: "blueprint_id + message required" }, { status: 400 });
  }
  try {
    const r = await copilotChat(blueprint_id, message);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
