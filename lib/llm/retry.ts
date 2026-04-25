export async function llmCallWithTransientRetry<T extends { output?: unknown }>(
  call: () => Promise<T>
): Promise<T> {
  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await call();
      const returnedError = transientErrorFromLlmResult(result);
      if (returnedError) throw returnedError;
      return result;
    } catch (error) {
      lastError = error;
      if (!isTransientUpstreamError(error) || attempt === maxAttempts) {
        throw error;
      }
      await waitBeforeRetry(attempt);
    }
  }
  throw lastError;
}

export function isTransientUpstreamError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /connection error|network|timeout|temporarily unavailable|rate limit/i.test(message);
}

function transientErrorFromLlmResult(result: { output?: unknown }): Error | null {
  const output = result.output;
  const message =
    output && typeof output === "object" && "error" in output
      ? String((output as { error?: unknown }).error ?? "")
      : "";
  return message && isTransientUpstreamError(message) ? new Error(message) : null;
}

function waitBeforeRetry(attempt: number): Promise<void> {
  if (process.env.NODE_ENV === "test") return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, attempt * 800));
}
