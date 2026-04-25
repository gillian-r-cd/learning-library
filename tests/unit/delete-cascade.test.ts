import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs";

const TEST_DB = path.join(process.cwd(), "data", `delete-cascade-${Date.now()}.db`);
process.env.LL_DB_PATH = TEST_DB;
process.env.LLM_MOCK = "1";

if (!fs.existsSync(path.dirname(TEST_DB))) {
  fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
}

// Eager-import db so rowCount() can stay synchronous. The LL_DB_PATH env above
// is read on first db() call (lazy singleton), and we never call db() before
// this point — so this import is fine.
import { db } from "@/lib/db";

beforeAll(() => {
  // touch the lazy singleton so connect/migrate run once up front
  db();
});

async function buildReadyBlueprint() {
  const { createBlueprint } = await import("@/lib/blueprint");
  const {
    runSkill1,
    runSkill2,
    runSkill3Skeleton,
    runSkill3Fill,
    runSkill4,
    runSkill5,
  } = await import("@/lib/skills");
  const bp = createBlueprint("情境领导力 · cascade", "d_cascade");
  await runSkill1(bp.blueprint_id);
  await runSkill2(bp.blueprint_id);
  const sk = await runSkill3Skeleton(bp.blueprint_id);
  await runSkill3Fill(bp.blueprint_id, sk.skeleton);
  await runSkill4(bp.blueprint_id);
  await runSkill5(bp.blueprint_id);
  return bp.blueprint_id;
}

function rowCount(table: string, where: string, ...params: unknown[]): number {
  const r = db().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params) as { n: number };
  return r.n;
}

describe("delete cascade", () => {
  it("deleteBlueprint wipes the blueprint and every dependent row in one transaction", async () => {
    const bpId = await buildReadyBlueprint();

    // Spin up two learners + a few turns each so we have non-empty rows in
    // every table (conversation_log, evidence_log, ledger, learner_states).
    const { createLearnerState } = await import("@/lib/state-manager");
    const { runTurn } = await import("@/lib/learning-runtime");
    const l1 = await createLearnerState(bpId);
    const l2 = await createLearnerState(bpId);
    for (const lid of [l1.learner_id, l2.learner_id]) {
      await runTurn({ learnerId: lid, input: "我观察到对方的态度，准备度大致是 R2。" });
      await runTurn({ learnerId: lid, input: "我会先肯定方向，再给一个明确动作。" });
    }

    expect(rowCount("blueprints", "blueprint_id = ?", bpId)).toBe(1);
    expect(rowCount("learner_states", "blueprint_id = ?", bpId)).toBe(2);
    const convBefore = rowCount("conversation_log", "learner_id IN (?, ?)", l1.learner_id, l2.learner_id);
    const evBefore = rowCount("evidence_log", "learner_id IN (?, ?)", l1.learner_id, l2.learner_id);
    const ledgerBefore = rowCount("ledger", "blueprint_id = ? OR learner_id IN (?, ?)", bpId, l1.learner_id, l2.learner_id);
    const auditBefore = rowCount("blueprint_audit", "blueprint_id = ?", bpId);
    expect(convBefore).toBeGreaterThan(0);
    expect(evBefore).toBeGreaterThan(0);
    expect(ledgerBefore).toBeGreaterThan(0);
    expect(auditBefore).toBeGreaterThan(0);

    const { deleteBlueprint } = await import("@/lib/blueprint");
    const counts = deleteBlueprint(bpId);

    expect(counts.blueprints).toBe(1);
    expect(counts.learners).toBe(2);
    expect(counts.conversation_log).toBe(convBefore);
    expect(counts.evidence_log).toBe(evBefore);
    expect(counts.ledger).toBe(ledgerBefore);
    expect(counts.blueprint_audit).toBe(auditBefore);

    // Everything tied to the blueprint or its learners must be gone.
    expect(rowCount("blueprints", "blueprint_id = ?", bpId)).toBe(0);
    expect(rowCount("learner_states", "blueprint_id = ?", bpId)).toBe(0);
    expect(rowCount("conversation_log", "learner_id IN (?, ?)", l1.learner_id, l2.learner_id)).toBe(0);
    expect(rowCount("evidence_log", "learner_id IN (?, ?)", l1.learner_id, l2.learner_id)).toBe(0);
    expect(rowCount("ledger", "blueprint_id = ?", bpId)).toBe(0);
    expect(rowCount("ledger", "learner_id IN (?, ?)", l1.learner_id, l2.learner_id)).toBe(0);
    expect(rowCount("blueprint_audit", "blueprint_id = ?", bpId)).toBe(0);
  });

  it("deleteLearner wipes the learner's logs but leaves the parent blueprint intact", async () => {
    const bpId = await buildReadyBlueprint();
    const { createLearnerState, deleteLearner } = await import("@/lib/state-manager");
    const { runTurn } = await import("@/lib/learning-runtime");
    const l = await createLearnerState(bpId);
    await runTurn({ learnerId: l.learner_id, input: "我会先观察再判断。" });

    const counts = deleteLearner(l.learner_id);
    expect(counts.learners).toBe(1);
    expect(counts.conversation_log).toBeGreaterThan(0);
    expect(counts.evidence_log).toBeGreaterThan(0);

    expect(rowCount("learner_states", "learner_id = ?", l.learner_id)).toBe(0);
    expect(rowCount("conversation_log", "learner_id = ?", l.learner_id)).toBe(0);
    expect(rowCount("evidence_log", "learner_id = ?", l.learner_id)).toBe(0);
    expect(rowCount("ledger", "learner_id = ?", l.learner_id)).toBe(0);

    // Blueprint untouched.
    expect(rowCount("blueprints", "blueprint_id = ?", bpId)).toBe(1);
  });

  it("deleteBlueprints batch deletes multiple blueprints atomically", async () => {
    const bp1 = await buildReadyBlueprint();
    const bp2 = await buildReadyBlueprint();
    const { deleteBlueprints } = await import("@/lib/blueprint");
    const counts = deleteBlueprints([bp1, bp2]);
    expect(counts.blueprints).toBe(2);
    expect(rowCount("blueprints", "blueprint_id IN (?, ?)", bp1, bp2)).toBe(0);
  });
});
