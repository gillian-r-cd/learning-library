import { listBlueprints } from "@/lib/blueprint";
import NewBlueprintForm from "./NewBlueprintForm";
import BlueprintList from "./BlueprintList";

export const dynamic = "force-dynamic";

export default function DesignHome() {
  const bps = listBlueprints().map((b) => ({
    blueprint_id: b.blueprint_id,
    topic: b.topic,
    step_status: b.step_status,
  }));
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
        <BlueprintList blueprints={bps} />
      </section>
    </div>
  );
}
