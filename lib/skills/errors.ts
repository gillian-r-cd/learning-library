import { isTransientUpstreamError } from "@/lib/llm/retry";

export function designSkillErrorStatus(error: unknown): number {
  return isTransientUpstreamError(error) ? 502 : 400;
}
