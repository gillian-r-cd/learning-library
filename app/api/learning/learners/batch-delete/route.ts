import { NextRequest, NextResponse } from "next/server";
import { deleteLearners } from "@/lib/state-manager";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string") : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids required (array of learner_id)" }, { status: 400 });
  }
  const counts = deleteLearners(ids);
  return NextResponse.json({ ok: true, deleted: counts });
}
