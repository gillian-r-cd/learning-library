import { NextRequest, NextResponse } from "next/server";
import {
  runSkill1,
  runSkill2,
  runSkill3Skeleton,
  runSkill3Fill,
  runSkill4,
  runSkill5,
  confirmStep,
} from "@/lib/skills";
import { getBlueprint } from "@/lib/blueprint";
import { designSkillErrorStatus } from "@/lib/skills/errors";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, blueprint_id, step, skeleton, hint } = body ?? {};
  if (!action || !blueprint_id) {
    return NextResponse.json({ error: "action + blueprint_id required" }, { status: 400 });
  }
  try {
    if (action === "run_skill_1") {
      const r = await runSkill1(blueprint_id, hint);
      return NextResponse.json({ ok: true, blueprint: r.blueprint, call_id: r.callId, trace_id: r.traceId });
    }
    if (action === "run_skill_2") {
      const r = await runSkill2(blueprint_id);
      return NextResponse.json({ ok: true, blueprint: r.blueprint, call_id: r.callId, trace_id: r.traceId });
    }
    if (action === "run_skill_3_skeleton") {
      const r = await runSkill3Skeleton(blueprint_id);
      return NextResponse.json({ ok: true, blueprint: r.blueprint, skeleton: r.skeleton, call_id: r.callId, trace_id: r.traceId });
    }
    if (action === "run_skill_3_fill") {
      const sk = skeleton;
      if (!sk) {
        const sg = await runSkill3Skeleton(blueprint_id);
        const r = await runSkill3Fill(blueprint_id, sg.skeleton);
        return NextResponse.json({ ok: true, blueprint: r.blueprint, call_id: r.callId, trace_id: r.traceId });
      }
      const r = await runSkill3Fill(blueprint_id, sk);
      return NextResponse.json({ ok: true, blueprint: r.blueprint, call_id: r.callId, trace_id: r.traceId });
    }
    if (action === "run_skill_4") {
      const r = await runSkill4(blueprint_id);
      return NextResponse.json({ ok: true, blueprint: r.blueprint, call_id: r.callId, trace_id: r.traceId });
    }
    if (action === "run_skill_5") {
      const r = await runSkill5(blueprint_id);
      return NextResponse.json({ ok: true, blueprint: r.blueprint, algorithm: true });
    }
    if (action === "confirm_step") {
      const bp = confirmStep(blueprint_id, step);
      return NextResponse.json({ ok: true, blueprint: bp });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    const error = (e as Error).message;
    const partialBlueprint =
      action === "run_skill_3_fill" && blueprint_id ? getBlueprint(blueprint_id) : null;
    return NextResponse.json(
      { error, ...(partialBlueprint ? { blueprint: partialBlueprint } : {}) },
      { status: designSkillErrorStatus(e) }
    );
  }
}
