import Link from "next/link";
import { listBlueprints } from "@/lib/blueprint";
import NewBlueprintForm from "./NewBlueprintForm";

export const dynamic = "force-dynamic";

export default function DesignHome() {
  const bps = listBlueprints();
  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">设计阶段</h1>
          <p className="text-sm text-muted">Design Copilot + Blueprint + Step Panel</p>
        </div>
      </header>
      <NewBlueprintForm />
      <section className="card">
        <h2 className="font-semibold mb-3">已有 Blueprint</h2>
        {bps.length === 0 ? (
          <p className="text-sm text-muted">还没有 Blueprint，新建一个吧。</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {bps.map((bp) => (
              <li key={bp.blueprint_id}>
                <Link
                  href={`/design/${bp.blueprint_id}`}
                  className="card-sub flex items-center justify-between hover:border-accent"
                  data-test-id={`bp-link-${bp.blueprint_id}`}
                >
                  <span>
                    <span className="font-semibold">{bp.topic}</span>{" "}
                    <span className="text-muted text-xs">{bp.blueprint_id}</span>
                  </span>
                  <span className="flex gap-1">
                    {(["step1", "step2", "step3", "step4", "step5"] as const).map((k) => (
                      <span key={k} className={`chip chip-${bp.step_status[k]}`}>{k}</span>
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
