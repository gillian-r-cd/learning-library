import Link from "next/link";
import { listBlueprints } from "@/lib/blueprint";
import {
  listLearners,
  conversationCount,
  lastConversationEntry,
} from "@/lib/state-manager";
import NewLearnerForm from "./NewLearnerForm";

export const dynamic = "force-dynamic";

function relativeTime(ts: string): string {
  const delta = Date.now() - new Date(ts).getTime();
  if (delta < 60_000) return "刚刚 · just now";
  if (delta < 3600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  const days = Math.floor(delta / 86_400_000);
  return `${days} 天前`;
}

export default function LearnHome() {
  const bps = listBlueprints().filter((b) => b.step_status.step5 !== "draft" || b.step5_points);
  const learners = listLearners();
  const ready = listBlueprints().filter(
    (b) => b.step3_script && b.step4_companions && b.step5_points
  );

  // Enrich each learner with conversation count + last message preview.
  const enriched = learners.map((l) => {
    const count = conversationCount(l.learner_id);
    const last = lastConversationEntry(l.learner_id);
    const bp = bps.find((b) => b.blueprint_id === l.blueprint_id);
    const preview = last
      ? last.text.length > 70
        ? last.text.slice(0, 70) + "…"
        : last.text
      : null;
    return { learner: l, count, last, preview, topic: bp?.topic ?? l.blueprint_id };
  });

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">学员旅程 / Learner Journeys</h1>
        <p className="text-sm text-muted">基于已生成的 Blueprint 启动一个学员 session。每个 session 的对话会持久化，随时可以回来继续。</p>
      </header>

      {ready.length === 0 ? (
        <div className="card text-sm text-muted">
          还没有可运行的 Blueprint。请先到{" "}
          <Link href="/design" className="text-accent">
            设计阶段
          </Link>{" "}
          跑完 5 步。
          <div className="mt-2 text-xs">
            最小要求：step3 剧本、step4 伴学、step5 积分都已生成。只要 Blueprint 有这些数据就能开跑，即使尚未 confirm。
          </div>
        </div>
      ) : (
        <NewLearnerForm blueprints={bps} />
      )}

      <section className="card">
        <h2 className="font-semibold mb-3">
          已有学员 / Existing learners <span className="text-muted text-xs font-normal">（共 {enriched.length} 位）</span>
        </h2>
        {enriched.length === 0 ? (
          <p className="text-sm text-muted">还没有 learner。开一个看看？</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {enriched.map(({ learner: l, count, last, preview, topic }) => (
              <li key={l.learner_id}>
                <Link
                  href={`/learn/${l.learner_id}`}
                  className="card-sub flex flex-col gap-1 hover:border-accent"
                  data-test-id={`learner-link-${l.learner_id}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{topic}</span>
                    <span className="text-muted text-xs font-mono">{l.learner_id}</span>
                    <span className="chip">{count} 条对话</span>
                    <span className="ml-auto text-xs text-muted">
                      {l.position.chapter_id} / {l.position.challenge_id} · {l.points.total} 分
                    </span>
                  </div>
                  {last ? (
                    <div className="text-xs text-muted">
                      <span className="chip">
                        {last.role === "learner"
                          ? "学员"
                          : last.role === "narrator"
                          ? "Narrator"
                          : last.role === "companion"
                          ? last.who ?? "伴学"
                          : last.who ?? "系统"}
                      </span>{" "}
                      <span className="text-text">{preview}</span>
                      <span className="ml-2 text-muted/70">· {relativeTime(last.ts)}</span>
                    </div>
                  ) : (
                    <div className="text-xs text-muted">尚无对话</div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
