import Link from "next/link";

export default function Home() {
  const cards = [
    {
      href: "/design",
      title: "设计阶段",
      desc: "课程设计师与 Copilot 共创，5 步产出旅程蓝图（Blueprint）。",
      testId: "card-design",
    },
    {
      href: "/learn",
      title: "学员旅程",
      desc: "State Manager + Judge + Narrator + Companion 协同驱动的单人旅程。",
      testId: "card-learn",
    },
    {
      href: "/admin",
      title: "运维后台",
      desc: "原始调用账本、指标看板、两级 Prompt Store、Trace。",
      testId: "card-admin",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl p-8 space-y-6">
      <section className="space-y-2">
        <h1 className="text-3xl font-bold">UMU Learning Library</h1>
        <p className="text-muted">
          以 Gamecore 为北极星，把一本书 / 方法论 / 技能领域转译成可反复执行核心动作的单人旅程。
        </p>
      </section>
      <section className="grid md:grid-cols-3 gap-4">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            data-test-id={c.testId}
            className="card hover:border-accent transition-colors"
          >
            <h3 className="font-semibold">{c.title}</h3>
            <p className="text-sm text-muted mt-2">{c.desc}</p>
          </Link>
        ))}
      </section>
      <section className="card space-y-2">
        <h2 className="font-semibold">开始使用</h2>
        <ol className="list-decimal list-inside text-sm text-muted space-y-1">
          <li>在「设计阶段」创建一个主题，按 5 步跑出 Blueprint 并逐步确认。</li>
          <li>在「学员旅程」用该 Blueprint 启动一个 learner，完成几轮交互。</li>
          <li>在「运维后台」查看每次 LLM 调用的 raw I/O、trace、指标，并编辑 prompt。</li>
        </ol>
      </section>
    </div>
  );
}
