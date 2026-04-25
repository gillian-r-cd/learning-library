import {
  isInvalidUpstreamOutputError,
  isTransientUpstreamError,
} from "@/lib/llm/retry";

export function designSkillErrorStatus(error: unknown): number {
  return isTransientUpstreamError(error) || isInvalidUpstreamOutputError(error) ? 502 : 400;
}
