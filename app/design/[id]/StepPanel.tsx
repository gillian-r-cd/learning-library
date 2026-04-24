"use client";
import type { Blueprint, ArtifactContent } from "@/lib/types/core";

function contentPreview(c: ArtifactContent | undefined): string {
  if (!c) return "";
  switch (c.type) {
    case "narrative":
      return (c.header?.subject ? `[${c.header.subject}] ` : "") + (c.body ?? "");
    case "fields": {
      const flat = c.fields ?? [];
      return flat.map((f) => `${f.key}=${f.value}`).join("; ");
    }
    case "series":
      return (c.entries ?? []).map((e) => e.text).join(" / ");
    case "list":
      return (c.items ?? []).map((i) => i.text).join(" · ");
    case "table":
      return (c.rows ?? []).map((r) => Object.values(r).join(",")).join(" | ");
    case "hierarchy":
      return `${c.root?.label ?? ""} / ${(c.root?.children ?? []).map((x) => x.label).join(",")}`;
  }
}

interface Props {
  step: 1 | 2 | 3 | 4 | 5;
  blueprint: Blueprint;
  onAction: (action: string, extra?: Record<string, unknown>) => Promise<unknown>;
}

export default function StepPanel(props: Props) {
  if (props.step === 1) return <Step1 {...props} />;
  if (props.step === 2) return <Step2 {...props} />;
  if (props.step === 3) return <Step3 {...props} />;
  if (props.step === 4) return <Step4 {...props} />;
  if (props.step === 5) return <Step5 {...props} />;
  return null;
}

function Header({
  step,
  name,
  status,
  onAction,
  runLabel,
  runAction,
  extra,
}: {
  step: 1 | 2 | 3 | 4 | 5;
  name: string;
  status: string;
  onAction: Props["onAction"];
  runLabel: string;
  runAction: string;
  extra?: Record<string, unknown>;
}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <h2 className="text-lg font-semibold">
        环节 {step}：{name}
      </h2>
      <span className={`chip chip-${status}`}>{status}</span>
      <div className="ml-auto flex gap-2">
        <button
          className="btn"
          data-test-id={`run-${runAction}`}
          onClick={() => onAction(runAction, extra)}
        >
          {runLabel}
        </button>
        <button
          className="btn-good"
          data-test-id={`confirm-step${step}`}
          onClick={() => onAction("confirm_step", { step: `step${step}` })}
        >
          确认 step{step}
        </button>
      </div>
    </div>
  );
}

function Step1({ blueprint: bp, onAction }: Props) {
  const s = bp.step1_gamecore;
  return (
    <div>
      <Header
        step={1}
        name="Gamecore 萃取"
        status={bp.step_status.step1}
        onAction={onAction}
        runLabel="运行 Skill 1"
        runAction="run_skill_1"
      />
      {!s ? (
        <p className="text-sm text-muted">
          尚未运行 Skill 1。点击右上的「运行 Skill 1」生成核心动作 + 质量矩阵。
        </p>
      ) : (
        <div className="space-y-4">
          {s.core_actions.map((a) => (
            <div key={a.action_id} className="card" data-test-id={`action-${a.action_id}`}>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{a.name}</span>
                <span className="chip">{a.knowledge_type}</span>
                <span className="text-muted text-xs">{a.action_id}</span>
              </div>
              <p className="text-sm text-muted mt-1">{a.description}</p>
              <div className="mt-3 overflow-x-auto">
                <table className="text-xs w-full border-collapse">
                  <thead>
                    <tr className="text-muted">
                      <th className="text-left py-1 pr-2">维度</th>
                      {(a.quality_matrix?.complexity_levels ?? []).map((c) => (
                        <th key={c} className="text-left py-1 pr-2">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(a.quality_matrix?.dimensions ?? []).map((d) => (
                      <tr key={d.dim_id} className="align-top">
                        <td className="py-1 pr-2 font-semibold">{d.name}</td>
                        {(a.quality_matrix?.complexity_levels ?? []).map((c) => {
                          const r = a.quality_matrix?.rubrics?.[d.dim_id]?.[c];
                          return (
                            <td key={c} className="py-1 pr-2 text-muted">
                              <div className="text-good">👍 {r?.good ?? "—"}</div>
                              <div>➖ {r?.medium ?? "—"}</div>
                              <div className="text-bad">👎 {r?.poor ?? "—"}</div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {s.reasoning_notes && (
            <div className="card-sub text-xs text-muted">
              <div className="label mb-1">reasoning_notes</div>
              {s.reasoning_notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Step2({ blueprint: bp, onAction }: Props) {
  const s = bp.step2_experience;
  return (
    <div>
      <Header
        step={2}
        name="游戏体验选型"
        status={bp.step_status.step2}
        onAction={onAction}
        runLabel="运行 Skill 2"
        runAction="run_skill_2"
      />
      {!s ? (
        <p className="text-sm text-muted">尚未运行 Skill 2。</p>
      ) : (
        <table className="text-sm w-full">
          <thead>
            <tr className="text-muted text-xs">
              <th className="text-left py-1">核心动作</th>
              <th className="text-left py-1">体验形式</th>
              <th className="text-left py-1">ICAP</th>
              <th className="text-left py-1">理由</th>
            </tr>
          </thead>
          <tbody>
            {s.mappings.map((m) => (
              <tr key={m.action_id} className="border-t border-border">
                <td className="py-2">{m.action_id}</td>
                <td className="py-2">{m.form_name}</td>
                <td className="py-2">{m.engagement_level}</td>
                <td className="py-2 text-muted">{m.rationale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Step3({ blueprint: bp, onAction }: Props) {
  const s = bp.step3_script;
  return (
    <div>
      <Header
        step={3}
        name="剧本与情节生成"
        status={bp.step_status.step3}
        onAction={onAction}
        runLabel="运行 Skill 3（骨架+填充）"
        runAction="run_skill_3_fill"
      />
      {!s ? (
        <p className="text-sm text-muted">尚未运行 Skill 3。</p>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-muted">
            {s.journey_meta.arc_type} / {s.journey_meta.tone} · 预计 {s.journey_meta.estimated_duration_min} 分钟
          </div>
          {s.chapters.map((c) => (
            <div key={c.chapter_id} className="card">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{c.title}</span>
                <span className="chip">{c.chapter_id}</span>
                <span className="ml-auto text-xs text-muted">里程碑：{c.milestone.summary}</span>
              </div>
              <p className="text-sm text-muted mt-1">{c.narrative_premise}</p>
              <div className="mt-3 space-y-2">
                {c.challenges.map((ch) => (
                  <details key={ch.challenge_id} className="card-sub">
                    <summary className="cursor-pointer">
                      <span className="font-semibold">{ch.title}</span>{" "}
                      <span className="chip">{ch.complexity}</span>{" "}
                      <span className="text-muted text-xs">
                        binds: {(ch.binds_actions ?? []).join(",")}
                      </span>
                    </summary>
                    <div className="text-xs mt-2 space-y-1">
                      <div>
                        <span className="label">setup：</span>
                        {ch.trunk?.setup ?? "—"}
                      </div>
                      <div>
                        <span className="label">action_prompts：</span>
                        <ul className="list-disc list-inside text-muted">
                          {(ch.trunk?.action_prompts ?? []).map((p, i) => (
                            <li key={i}>{p}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <span className="label">expected_signals：</span>
                        <ul className="list-disc list-inside text-muted">
                          {(ch.trunk?.expected_signals ?? []).map((p, i) => (
                            <li key={i}>{p}</li>
                          ))}
                        </ul>
                      </div>
                      {(ch.companion_hooks ?? []).length > 0 && (
                        <div>
                          <span className="label">companion_hooks：</span>
                          <ul className="list-disc list-inside text-muted">
                            {(ch.companion_hooks ?? []).map((h, idx) => (
                              <li key={h?.hook_id ?? idx}>
                                [{h?.condition?.companion_type ?? "—"} ≥ Lv
                                {h?.condition?.min_level ?? "?"}]{" "}
                                {h?.delta?.pre_action_injection ?? ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {(ch.artifacts ?? []).length > 0 && (
                        <div data-test-id={`artifacts-preview-${ch.challenge_id}`}>
                          <span className="label">artifacts（道具）：</span>
                          <ul className="list-disc list-inside text-muted">
                            {(ch.artifacts ?? []).map((a, idx) => {
                              const preview = contentPreview(a.content).slice(0, 60);
                              return (
                                <li key={a.artifact_id ?? idx}>
                                  <span className="text-accent">{a.icon_hint ?? "🎒"} {a.name}</span>{" "}
                                  <span className="chip">{a.type}</span>{" "}
                                  <span className="chip">{a.trigger}</span>{" "}
                                  <span className="chip">v{a.version}</span>
                                  {preview && (
                                    <span className="text-muted/80"> · {preview}…</span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Step4({ blueprint: bp, onAction }: Props) {
  const s = bp.step4_companions;
  return (
    <div>
      <Header
        step={4}
        name="高级伴学清单"
        status={bp.step_status.step4}
        onAction={onAction}
        runLabel="运行 Skill 4"
        runAction="run_skill_4"
      />
      {!s ? (
        <p className="text-sm text-muted">尚未运行 Skill 4。</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {s.companions.map((c) => (
            <div key={c.companion_id} className="card" data-test-id={`companion-${c.companion_id}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{c.display_name ?? c.companion_id}</span>
                <span className="chip">{c.companion_type ?? "—"}</span>
                <span className="ml-auto chip">
                  解锁 @ {c.unlock_rule?.value ?? "—"} 分
                </span>
              </div>
              <div className="divider" />
              <div className="text-xs space-y-1 text-muted">
                <div>
                  <span className="label">唯一价值：</span>
                  {c.unique_value_hypothesis || "—"}
                </div>
                <div>
                  <span className="label">有效性机制：</span>
                  {c.effectiveness_mechanism || "—"}
                </div>
                <div>
                  <span className="label">升级路径：</span>
                  {(c.upgrade_path ?? []).length === 0 ? (
                    <span>—</span>
                  ) : (
                    (c.upgrade_path ?? []).map((u, i) => (
                      <span key={i}>
                        Lv.{u?.level ?? i + 1} {u?.delta ?? ""}{" "}
                      </span>
                    ))
                  )}
                </div>
                <div>
                  <span className="label">priority：</span>
                  {c.companion_priority ?? "—"} · output: {c.output_format ?? "—"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Step5({ blueprint: bp, onAction }: Props) {
  const s = bp.step5_points;
  return (
    <div>
      <Header
        step={5}
        name="积分系统配置"
        status={bp.step_status.step5}
        onAction={onAction}
        runLabel="运行 Skill 5（算法）"
        runAction="run_skill_5"
      />
      {!s ? (
        <p className="text-sm text-muted">尚未运行 Skill 5。</p>
      ) : (
        <div className="space-y-3">
          <div className="card-sub text-xs">
            <div className="label">总容量估算</div>
            <div className="text-accent text-lg">{s.total_capacity} 分</div>
          </div>
          <div className="card">
            <h3 className="font-semibold text-sm mb-2">Fit Diagnostics（Monte Carlo 模拟）</h3>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="card-sub">
                <div className="text-muted">快速学员首次解锁</div>
                <div className="text-accent">challenge #{s.fit_diagnostics.fast_learner_unlock_first_at}</div>
              </div>
              <div className="card-sub">
                <div className="text-muted">中位学员</div>
                <div className="text-accent">challenge #{s.fit_diagnostics.median_learner_unlock_first_at}</div>
              </div>
              <div className="card-sub">
                <div className="text-muted">慢速学员</div>
                <div className="text-accent">challenge #{s.fit_diagnostics.slow_learner_unlock_first_at}</div>
              </div>
            </div>
          </div>
          <div className="card">
            <h3 className="font-semibold text-sm mb-2">解锁阈值</h3>
            <ul className="text-xs space-y-1">
              {s.instance_params.unlock_thresholds.map((t) => (
                <li key={t.companion_id}>
                  {t.companion_id}: <span className="text-accent">≥ {t.threshold} 分</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h3 className="font-semibold text-sm mb-2">FSRS 衰减参数</h3>
            <div className="text-xs grid grid-cols-2 gap-2">
              {Object.entries(s.instance_params.decay.params_by_knowledge_type).map(([kt, p]) => (
                <div key={kt} className="card-sub">
                  <div className="text-muted">{kt}</div>
                  <div>初始 S: {p.initial_stability} 天 · 增长 ×{p.stability_growth}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
