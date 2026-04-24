import { getPromptHistory, getPublishedPrompt } from "@/lib/prompt-store";
import Link from "next/link";
import PromptEditor from "./PromptEditor";

export const dynamic = "force-dynamic";

export default async function EditPrompt({
  searchParams,
}: {
  searchParams: Promise<{ key?: string; scope?: string }>;
}) {
  const sp = await searchParams;
  const key = sp.key;
  const scope = sp.scope;
  if (!key || !scope) {
    return (
      <div className="p-6 text-sm text-muted">
        缺少 key/scope 参数。 / Missing key/scope parameters.
      </div>
    );
  }
  const current = getPublishedPrompt(key, scope);
  const history = getPromptHistory(key, scope);

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-4">
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-bold">
          编辑提示词 <span className="text-muted font-normal text-base">Edit Prompt</span>
        </h1>
        <span className="chip">{scope}</span>
        <span className="font-mono text-accent text-xs">{key}</span>
        <Link href="/admin/prompts" className="btn text-xs">← 返回 Back</Link>
      </header>
      <PromptEditor
        keyName={key}
        scope={scope}
        current={current}
        history={history.map((h) => ({ version: h.version, created_at: h.created_at, status: h.status, note: h.note ?? null }))}
      />
    </div>
  );
}
