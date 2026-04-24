import { NextRequest, NextResponse } from "next/server";
import { computeMetrics } from "@/lib/ledger";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const window = url.searchParams.get("window_sec");
  const metrics = computeMetrics(window ? Number(window) : undefined);
  return NextResponse.json({ metrics });
}
