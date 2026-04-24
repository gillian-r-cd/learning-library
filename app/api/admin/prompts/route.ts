import { NextRequest, NextResponse } from "next/server";
import {
  listPromptKeys,
  getPromptHistory,
  upsertPrompt,
  getPublishedPrompt,
} from "@/lib/prompt-store";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const scope = url.searchParams.get("scope");
  if (key && scope) {
    const history = getPromptHistory(key, scope);
    const current = getPublishedPrompt(key, scope);
    return NextResponse.json({ history, current });
  }
  return NextResponse.json({ keys: listPromptKeys() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { key, scope, body: promptBody, created_by, note } = body ?? {};
  if (!key || !scope || !promptBody) {
    return NextResponse.json({ error: "key/scope/body required" }, { status: 400 });
  }
  const r = upsertPrompt({
    key,
    scope,
    status: "published",
    body: promptBody,
    created_by: created_by ?? "admin",
    note,
  });
  return NextResponse.json({ prompt: r });
}
