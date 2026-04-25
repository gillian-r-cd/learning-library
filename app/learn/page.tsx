import Link from "next/link";
import { listBlueprints } from "@/lib/blueprint";
import {
  listLearners,
  conversationCount,
  lastConversationEntry,
} from "@/lib/state-manager";
import NewLearnerForm from "./NewLearnerForm";
import LearnerList, { type LearnerRow } from "./LearnerList";

export const dynamic = "force-dynamic";

export default function LearnHome() {
  const bps = listBlueprints().filter((b) => b.step_status.step5 !== "draft" || b.step5_points);
  const learners = listLearners();
  const ready = listBlueprints().filter(
    (b) => b.step3_script && b.step4_companions && b.step5_points
  );

  const rows: LearnerRow[] = learners.map((l) => {
    const count = conversationCount(l.learner_id);
    const last = lastConversationEntry(l.learner_id);
    const bp = bps.find((b) => b.blueprint_id === l.blueprint_id);
    const preview = last
      ? last.text.length > 70
        ? last.text.slice(0, 70) + "…"
        : last.text
      : null;
    return {
      learner_id: l.learner_id,
      topic: bp?.topic ?? l.blueprint_id,
      count,
      position_chapter: l.position.chapter_id,
      position_challenge: l.position.challenge_id,
      points_total: l.points.total,
      preview,
      last_role: last?.role ?? null,
      last_who: last?.who ?? null,
      last_ts: last?.ts ?? null,
    };
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
          已有学员 / Existing learners <span className="text-muted text-xs font-normal">（共 {rows.length} 位）</span>
        </h2>
        <LearnerList learners={rows} />
      </section>
    </div>
  );
}
