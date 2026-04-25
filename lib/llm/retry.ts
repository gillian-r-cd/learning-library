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

export async function llmCallWithValidationRetry<T extends { output?: unknown }, V>(
  call: () => Promise<T>,
  validate: (result: T) => V
): Promise<V> {
  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await call();
      const returnedError = transientErrorFromLlmResult(result);
      if (returnedError) throw returnedError;
      return validate(result);
    } catch (error) {
      lastError = error;
      if (!isRetryableUpstreamError(error) || attempt === maxAttempts) {
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

export class LlmInvalidOutputError extends Error {
  readonly code = "llm_invalid_output" as const;

  constructor(message: string) {
    super(message);
    this.name = "LlmInvalidOutputError";
  }
}

export function isInvalidUpstreamOutputError(error: unknown): boolean {
  return (
    error instanceof LlmInvalidOutputError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "llm_invalid_output")
  );
}

function isRetryableUpstreamError(error: unknown): boolean {
  return isTransientUpstreamError(error) || isInvalidUpstreamOutputError(error);
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
