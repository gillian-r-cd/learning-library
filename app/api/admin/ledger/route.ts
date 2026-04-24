import { NextRequest, NextResponse } from "next/server";
import { queryLedger, getLedgerById, getLedgerByTrace } from "@/lib/ledger";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const call_id = url.searchParams.get("call_id");
  const trace_id = url.searchParams.get("trace_id");
  if (call_id) {
    const r = getLedgerById(call_id);
    if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ record: r });
  }
  if (trace_id) {
    const r = getLedgerByTrace(trace_id);
    return NextResponse.json({ records: r });
  }
  const f = {
    stage: url.searchParams.get("stage") ?? undefined,
    caller: url.searchParams.get("caller") ?? undefined,
    learner_id: url.searchParams.get("learner_id") ?? undefined,
    blueprint_id: url.searchParams.get("blueprint_id") ?? undefined,
    limit: Number(url.searchParams.get("limit") ?? "50"),
    offset: Number(url.searchParams.get("offset") ?? "0"),
  };
  return NextResponse.json({ records: queryLedger(f) });
}
