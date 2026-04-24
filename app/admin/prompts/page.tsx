import Link from "next/link";
import { listPromptKeys } from "@/lib/prompt-store";
import { listBlueprints } from "@/lib/blueprint";

export const dynamic = "force-dynamic";

export default function PromptsHome() {
  const keys = listPromptKeys();
  const bps = listBlueprints();
  const system = keys.filter((k) => k.scope === "system");
  const course = keys.filter((k) => k.scope !== "system");

  const groups: { zh: string; en: string; items: typeof system }[] = [
    {
      zh: "设计阶段",
      en: "Design phase",
      items: system.filter((k) => k.key.startsWith("skill_") || k.key === "design_copilot_chat.template"),
    },
    {
      zh: "学习阶段",
      en: "Learning phase",
      items: system.filter((k) =>
        [
          "judge.template",
          "narrator.template",
          "companion.template",
          "summary_compressor.template",
          "recap_generator.template",
        ].includes(k.key)
      ),
    },
    {
      zh: "其他",
      en: "Other",
      items: system.filter(
        (k) =>
          !k.key.startsWith("skill_") &&
          ![
            "design_copilot_chat.template",
            "judge.template",
            "narrator.template",
            "companion.template",
            "summary_compressor.template",
            "recap_generator.template",
          ].includes(k.key)
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-4">
      <header className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">
          Prompt Store <span className="text-muted font-normal text-base">提示词仓库</span>
        </h1>
        <Link href="/admin" className="btn text-xs">← 返回 Back</Link>
      </header>

      <div className="card-sub text-xs text-muted">
        点击任意模板卡片即可编辑 system prompt / user template / model / temperature / max_tokens，Publish 新版本即热更新生效。<br />
        Click any template card to edit its system prompt / user template / model / temperature / max_tokens; Publish creates a new version and hot-reloads.
      </div>

      <section className="card">
        <h2 className="font-semibold">
          系统级 <span className="text-muted font-normal text-sm">System-level</span>
        </h2>
        <p className="text-xs text-muted mb-3">
          跨所有课程共享的默认 prompt。 / Defaults shared across all courses.
        </p>
        {groups.map(
          (g) =>
            g.items.length > 0 && (
              <div key={g.zh} className="mb-3">
                <div className="label mb-1">
                  {g.zh} <span className="text-muted/70">{g.en}</span>
                </div>
                <ul className="space-y-1 text-sm">
                  {g.items.map((k) => (
                    <li key={`${k.key}@${k.scope}`}>
                      <Link
                        href={`/admin/prompts/edit?key=${encodeURIComponent(k.key)}&scope=${encodeURIComponent(k.scope)}`}
                        className="card-sub flex items-center justify-between hover:border-accent"
                        data-test-id={`prompt-link-${k.key}`}
                      >
                        <span>
                          <span className="font-mono text-accent text-xs">{k.key}</span>
                        </span>
                        <span className="text-xs text-muted">
                          v{k.version} · {k.status} <span className="text-accent ml-2">编辑 Edit →</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )
        )}
      </section>

      <section className="card">
        <h2 className="font-semibold">
          课程级 Overrides <span className="text-muted font-normal text-sm">Course-level overrides</span>
        </h2>
        <p className="text-xs text-muted mb-3">
          绑定到具体 Blueprint 的覆盖项。课程级 override 系统级，局部字段生效。<br />
          Overrides bound to a specific Blueprint; partial fields override the system-level template.
        </p>
        {course.length === 0 ? (
          <p className="text-xs text-muted">
            当前没有课程级 override。进入下方某个 Blueprint 创建第一个 override。<br />
            No course-level overrides yet. Pick a Blueprint below to create the first one.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {course.map((k) => (
              <li key={`${k.key}@${k.scope}`}>
                <Link
                  href={`/admin/prompts/edit?key=${encodeURIComponent(k.key)}&scope=${encodeURIComponent(k.scope)}`}
                  className="card-sub flex items-center justify-between hover:border-accent"
                >
                  <span>
                    <span className="font-mono text-accent text-xs">{k.key}</span>{" "}
                    <span className="text-xs text-muted">{k.scope}</span>
                  </span>
                  <span className="text-xs text-muted">
                    v{k.version} <span className="text-accent ml-2">编辑 Edit →</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="divider" />
        <div className="label mb-1">
          为某个 Blueprint 快捷创建课程级 Override <span className="text-muted/70">/ Create an override for a Blueprint</span>
        </div>
        <ul className="text-xs space-y-1">
          {bps.map((b) => (
            <li key={b.blueprint_id}>
              <Link
                href={`/admin/prompts/new?scope=${encodeURIComponent(`course:${b.blueprint_id}`)}`}
                className="card-sub hover:border-accent"
              >
                {b.topic} <span className="text-muted">({b.blueprint_id})</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
