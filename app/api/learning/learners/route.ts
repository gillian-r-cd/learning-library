import { NextRequest, NextResponse } from "next/server";
import {
  createLearnerState,
  listLearners,
  conversationCount,
  lastConversationEntry,
} from "@/lib/state-manager";

export async function GET() {
  const learners = listLearners().map((l) => {
    const count = conversationCount(l.learner_id);
    const last = lastConversationEntry(l.learner_id);
    return {
      ...l,
      conversation_count: count,
      last_message: last
        ? {
            role: last.role,
            who: last.who,
            text: last.text,
            ts: last.ts,
            preview: last.text.length > 60 ? last.text.slice(0, 60) + "…" : last.text,
          }
        : null,
    };
  });
  return NextResponse.json({ learners });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { blueprint_id, learner_id } = body ?? {};
  if (!blueprint_id) {
    return NextResponse.json({ error: "blueprint_id required" }, { status: 400 });
  }
  try {
    const s = await createLearnerState(blueprint_id, learner_id);
    return NextResponse.json({ learner: s });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
