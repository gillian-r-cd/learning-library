// Companion hook matcher — wires the `challenge.companion_hooks[]` field
// defined at design time (Skill 3) into the learning runtime.
//
// Until now this field was read by the designer UI (StepPanel) and NOTHING
// ELSE. The whole `condition: {companion_type, min_level}` + `delta:
// {pre_action_injection, post_action_injection, scaffold_override}` structure
// was a dead letter: Judge never saw it, companions never executed it.
//
// This matcher resolves, for a given challenge + set of active companions,
// which hooks FIRE and produces a compact digest the runtime feeds to Judge
// (for dispatch decisions) and to each companion LLM call (as part of its
// directive).

import type { Blueprint, Companion, LearnerState } from "@/lib/types/core";

export interface ActiveCompanionHook {
  companion_id: string;
  display_name: string;
  companion_type: string;
  level: number;
  /** Combined text from delta.pre_action_injection / post_action_injection
   *  / scaffold_override, ready to concat into a directive. Never empty. */
  hook_text: string;
  /** Each component separately for callers that want to inject at different
   *  places (Narrator may only need pre_action_injection as background,
   *  while companion needs the whole thing). */
  pre_action_injection?: string;
  post_action_injection?: string;
  scaffold_override?: string | null;
  /** The raw hook_id from the blueprint, for audit. */
  hook_id: string;
}

export function matchActiveCompanionHooks(args: {
  blueprint: Blueprint;
  challengeId: string;
  learner: LearnerState;
}): ActiveCompanionHook[] {
  const { blueprint: bp, challengeId, learner } = args;
  const challenge = findChallenge(bp, challengeId);
  if (!challenge) return [];
  const hooks = challenge.companion_hooks ?? [];
  if (hooks.length === 0) return [];

  const companionsById = new Map<string, Companion>();
  for (const c of bp.step4_companions?.companions ?? []) {
    companionsById.set(c.companion_id, c);
  }
  const unlockedById = new Map(
    learner.unlocked_companions.map((u) => [u.companion_id, u])
  );

  const results: ActiveCompanionHook[] = [];
  for (const h of hooks) {
    const targetType = h.condition?.companion_type;
    const minLevel = h.condition?.min_level ?? 1;
    if (!targetType) continue;
    // Find EVERY active companion matching this type + level.
    for (const companion of companionsById.values()) {
      if (companion.companion_type !== targetType) continue;
      const unlock = unlockedById.get(companion.companion_id);
      if (!unlock) continue;
      if (unlock.level < minLevel) continue;
      const pre = h.delta?.pre_action_injection?.trim();
      const post = h.delta?.post_action_injection?.trim();
      const scaffold = h.delta?.scaffold_override;
      const parts = [pre, post].filter((p): p is string => !!p);
      const hookText = parts.join(" / ");
      if (!hookText && !scaffold) continue; // nothing to say
      results.push({
        companion_id: companion.companion_id,
        display_name: companion.display_name,
        companion_type: companion.companion_type,
        level: unlock.level,
        hook_text: hookText || scaffold || "",
        pre_action_injection: pre || undefined,
        post_action_injection: post || undefined,
        scaffold_override: scaffold ?? null,
        hook_id: h.hook_id,
      });
    }
  }
  return results;
}

function findChallenge(bp: Blueprint, challengeId: string) {
  for (const chap of bp.step3_script?.chapters ?? []) {
    const c = chap.challenges?.find((x) => x.challenge_id === challengeId);
    if (c) return c;
  }
  return null;
}
