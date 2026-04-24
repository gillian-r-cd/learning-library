import { NextRequest, NextResponse } from "next/server";
import { resetPromptToSeed } from "@/lib/prompt-store/seed";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const key = body?.key as string | undefined;
  if (!key) {
    return NextResponse.json({ error: "key required" }, { status: 400 });
  }
  try {
    const result = resetPromptToSeed(key);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
