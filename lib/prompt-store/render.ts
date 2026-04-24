// Prompt rendering (placeholder substitution, Jinja-lite)

export interface PromptBody {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  max_tokens?: number;
  temperature?: number;
  model?: string;
  systemVersion?: number;
  courseVersion?: number | null;
}

export function renderTemplate(
  body: PromptBody,
  variables: Record<string, unknown>
): PromptBody {
  return {
    ...body,
    system: substitute(body.system, variables),
    messages: body.messages.map((m) => ({
      role: m.role,
      content: substitute(m.content, variables),
    })),
  };
}

function substitute(input: string, vars: Record<string, unknown>): string {
  return input.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => {
    const parts = String(key).split(".");
    let cur: unknown = vars;
    for (const p of parts) {
      if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return `{{${key}}}`;
      }
    }
    if (typeof cur === "string") return cur;
    if (cur === undefined || cur === null) return "";
    try {
      return JSON.stringify(cur);
    } catch {
      return String(cur);
    }
  });
}
