import Link from "next/link";
import NewPromptForm from "./NewPromptForm";

export const dynamic = "force-dynamic";

const SYSTEM_KEYS = [
  "design_copilot_chat.template",
  "skill_1_gamecore.template",
  "skill_2_experience.template",
  "skill_3_script_skeleton.template",
  "skill_3_script_fill.template",
  "skill_4_companion.template",
  "judge.template",
  "narrator.template",
  "companion.template",
  "summary_compressor.template",
  "recap_generator.template",
];

export default async function NewPrompt({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const sp = await searchParams;
  const scope = sp.scope ?? "system";
  return (
    <div className="mx-auto max-w-3xl p-6 space-y-4">
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-bold">
          新建课程级 Override <span className="text-muted font-normal text-base">Create Course-level Override</span>
        </h1>
        <Link href="/admin/prompts" className="btn text-xs">← 返回 Back</Link>
      </header>
      <NewPromptForm scope={scope} systemKeys={SYSTEM_KEYS} />
    </div>
  );
}
