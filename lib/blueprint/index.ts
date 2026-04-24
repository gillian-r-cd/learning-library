// Blueprint CRUD and audit log

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Blueprint, StepStatus } from "@/lib/types/core";

export function createBlueprint(topic: string, designerId: string): Blueprint {
  const id = `bp_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const bp: Blueprint = {
    blueprint_id: id,
    topic,
    version: 1,
    status: "in_design",
    created_at: now,
    updated_at: now,
    designer_id: designerId,
    step_status: {
      step1: "draft",
      step2: "draft",
      step3: "draft",
      step4: "draft",
      step5: "draft",
    },
  };
  db()
    .prepare(
      `INSERT INTO blueprints (blueprint_id, topic, version, status, created_at, updated_at, designer_id, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(bp.blueprint_id, bp.topic, bp.version, bp.status, bp.created_at, bp.updated_at, bp.designer_id, JSON.stringify(bp));
  return bp;
}

export function getBlueprint(id: string): Blueprint | null {
  const row = db()
    .prepare(`SELECT data_json FROM blueprints WHERE blueprint_id = ?`)
    .get(id) as { data_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data_json) as Blueprint;
}

export function listBlueprints(): Blueprint[] {
  const rows = db()
    .prepare(`SELECT data_json FROM blueprints ORDER BY updated_at DESC`)
    .all() as { data_json: string }[];
  return rows.map((r) => JSON.parse(r.data_json) as Blueprint);
}

export function updateBlueprint(bp: Blueprint): Blueprint {
  bp.updated_at = new Date().toISOString();
  db()
    .prepare(
      `UPDATE blueprints SET topic = ?, version = ?, status = ?, updated_at = ?, data_json = ? WHERE blueprint_id = ?`
    )
    .run(bp.topic, bp.version, bp.status, bp.updated_at, JSON.stringify(bp), bp.blueprint_id);
  return bp;
}

export function auditStep(blueprintId: string, step: number, version: number, skillOutput: unknown) {
  db()
    .prepare(
      `INSERT INTO blueprint_audit (blueprint_id, step, version, at, skill_output) VALUES (?, ?, ?, ?, ?)`
    )
    .run(blueprintId, step, version, new Date().toISOString(), JSON.stringify(skillOutput));
}

const STEP_KEYS = ["step1", "step2", "step3", "step4", "step5"] as const;
type StepKey = (typeof STEP_KEYS)[number];

/** PRD §5.5 cascade matrix. */
export function cascadeStale(bp: Blueprint, changedStep: StepKey): Blueprint {
  const order: StepKey[] = ["step1", "step2", "step3", "step4", "step5"];
  const idx = order.indexOf(changedStep);
  const newStatus: Record<StepKey, StepStatus> = { ...bp.step_status };
  for (let i = idx + 1; i < order.length; i++) {
    if (newStatus[order[i]] === "confirmed") newStatus[order[i]] = "stale";
  }
  newStatus[changedStep] = "confirmed";
  bp.step_status = newStatus;
  return bp;
}

export function setStepStatus(bp: Blueprint, step: StepKey, status: StepStatus): Blueprint {
  bp.step_status[step] = status;
  return bp;
}

export function isReady(bp: Blueprint): boolean {
  return STEP_KEYS.every((k) => bp.step_status[k] === "confirmed");
}
