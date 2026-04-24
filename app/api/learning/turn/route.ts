import { NextRequest, NextResponse } from "next/server";
import { runTurn } from "@/lib/learning-runtime";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { learner_id, input, recent_turns } = body ?? {};
  if (!learner_id || typeof input !== "string") {
    return NextResponse.json({ error: "learner_id + input required" }, { status: 400 });
  }
  try {
    const result = await runTurn({ learnerId: learner_id, input, recentTurns: recent_turns });
    return NextResponse.json(result);
  } catch (e) {
    const err = e as Error;
    // Keep the stack in server logs for debugging, but give the learner a
    // clean, non-leaky message (no raw TypeError / internal field names).
    console.error("[runTurn] failed", {
      learner_id,
      error: err.message,
      stack: err.stack,
    });
    return NextResponse.json(
      {
        error:
          "系统在处理这一轮时遇到一个问题，你的输入已经保存，请再发一次或刷新。运维后台会收到错误详情。 / Something went wrong processing this turn — your input is saved, please retry.",
        internal_message: err.message, // hidden in UI unless explicitly surfaced
      },
      { status: 500 }
    );
  }
}
