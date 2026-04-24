// Companion Agents runtime (PRD §6.3.4)

import { llmCall } from "@/lib/llm";
import { getBlueprint } from "@/lib/blueprint";
import { db } from "@/lib/db";
import type { Snapshot } from "@/lib/state-manager";
import type { ActiveCompanionHook } from "@/lib/learning-runtime/companion-hooks";
import type {
  Companion,
  JudgeOutput,
  ScaffoldStrategy,
} from "@/lib/types/core";

export interface CompanionSpeech {
  companion_id: string;
  display_name: string;
  text: string;
  format: string;
  callId: string;
}

export async function runCompanions(args: {
  snapshot: Snapshot;
  dispatch: JudgeOutput["companion_dispatch"];
  /** Blueprint-declared hooks for the current challenge, resolved to the
   *  companions actually active right now. Companions merge the hook_text
   *  into their directive before the LLM call so the designer's
   *  per-challenge intent actually fires. */
  challengeCompanionHooks?: ActiveCompanionHook[];
  /** The Narrator's scaffold strategy this turn (if any). Companions align
   *  their output to the Narrator's cognitive-support posture rather than
   *  competing with it. */
  scaffoldStrategy?: ScaffoldStrategy | null;
  traceId: string;
  parentSpanId?: string;
}): Promise<CompanionSpeech[]> {
  const bp = getBlueprint(args.snapshot.learner.blueprint_id);
  if (!bp?.step4_companions) return [];
  const companions = bp.step4_companions.companions;

  // PRD §7.2.3 rules: cap 3 active, 2 speakers
  const speakers = args.dispatch
    .filter((d) => d.role === "speaker")
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 2);

  const hooksById = new Map<string, ActiveCompanionHook[]>();
  for (const h of args.challengeCompanionHooks ?? []) {
    const arr = hooksById.get(h.companion_id) ?? [];
    arr.push(h);
    hooksById.set(h.companion_id, arr);
  }

  // Current level per companion (authoritative at dispatch time) — informs
  // the companion's relationship_stages alignment.
  const levelById = new Map<string, number>();
  for (const u of args.snapshot.learner.unlocked_companions) {
    levelById.set(u.companion_id, u.level);
  }

  const results: CompanionSpeech[] = [];
  // Execute in parallel
  const runs = speakers.map(async (sp) => {
    const companion = companions.find((c) => c.companion_id === sp.companion_id);
    if (!companion) return null;
    const hooks = hooksById.get(sp.companion_id) ?? [];
    const mergedDirective = buildMergedDirective(sp.directive, hooks);
    const level = levelById.get(sp.companion_id) ?? 1;
    // Pull this companion's last 3 speeches so the LLM can avoid repetition.
    const myRecentLines = fetchRecentCompanionLines(
      args.snapshot.learner.learner_id,
      companion.display_name,
      3
    );
    return runOne(
      args.snapshot,
      companion,
      mergedDirective,
      level,
      hooks,
      myRecentLines,
      args.scaffoldStrategy ?? null,
      args.traceId,
      args.parentSpanId
    );
  });
  for (const r of await Promise.all(runs)) {
    if (r) results.push(r);
  }
  return results;
}

function fetchRecentCompanionLines(
  learnerId: string,
  displayName: string,
  count: number
): string[] {
  const rows = db()
    .prepare(
      `SELECT text FROM conversation_log
       WHERE learner_id = ? AND role = 'companion' AND who = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(learnerId, displayName, count) as Array<{ text: string }>;
  return rows.map((r) => r.text);
}

function buildMergedDirective(
  judgeDirective: string,
  hooks: ActiveCompanionHook[]
): string {
  if (hooks.length === 0) return judgeDirective;
  const hookStrings = hooks
    .map((h) => h.hook_text)
    .filter((s) => s && s.length > 0);
  if (hookStrings.length === 0) return judgeDirective;
  // Put the blueprint hook FIRST (designer intent > runtime-synthesized
  // directive). Then Judge's directive as secondary guidance.
  return `【本挑战专属指令】${hookStrings.join("；")}\n【本轮 Judge 指令】${judgeDirective || "在人设内做一次自然插话"}`;
}

async function runOne(
  snapshot: Snapshot,
  companion: Companion,
  directive: string,
  level: number,
  hooks: ActiveCompanionHook[],
  myRecentLines: string[],
  scaffoldStrategy: ScaffoldStrategy | null,
  traceId: string,
  parentSpanId: string | undefined
): Promise<CompanionSpeech | null> {
  // Pick the persona stage that matches this companion's current level.
  const stages = companion.persona?.relationship_stages ?? [];
  const currentStage =
    stages.find((s) => s.level === level) ?? stages[stages.length - 1] ?? null;
  const upgradeDelta = (companion.upgrade_path ?? []).find((u) => u.level === level);

  const res = await llmCall({
    caller: `companion:${companion.companion_id}`,
    stage: "learning",
    traceId,
    parentSpanId,
    learnerId: snapshot.learner.learner_id,
    blueprintId: snapshot.learner.blueprint_id,
    userVisible: true,
    variables: {
      persona: {
        display_name: companion.display_name,
        companion_type: companion.companion_type,
        output_format: companion.output_format,
        ...companion.persona,
        io_spec: companion.io_spec,
      },
      directive,
      memory_summary: `你是 ${companion.display_name}（${companion.companion_type}，当前 Lv.${level}：${upgradeDelta?.delta ?? "基础形态"}；关系阶段：${currentStage?.stance ?? "中立"}），与学员互动已 ${snapshot.learner.position.turn_idx} 轮。`,
      challenge_hooks: hooks.map((h) => ({
        pre: h.pre_action_injection ?? "",
        post: h.post_action_injection ?? "",
        scaffold: h.scaffold_override ?? "",
      })),
      current_level: level,
      scaffold_strategy: scaffoldStrategy ?? "",
      my_recent_lines: myRecentLines,
    },
  });
  // Companion may exercise its "silent right" (prompt-level contract) and
  // return an empty/whitespace-only string. Treat as no-op so the UI doesn't
  // render a hollow bubble.
  const text = (res.text ?? "").trim();
  if (!text) return null;
  return {
    companion_id: companion.companion_id,
    display_name: companion.display_name,
    text,
    format: companion.output_format,
    callId: res.callId,
  };
}
