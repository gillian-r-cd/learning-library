// Client-side fetch helper. All `fetch()` calls in React components must go
// through this wrapper so that network errors (server down, DNS, offline,
// CORS, aborted) are never unhandled TypeErrors that crash the React tree.
//
// Contract:
//   - Resolves to a normalised { ok, status, data, error } object.
//   - Never throws.
//   - On network failure: ok=false, status=0, error describes the cause.
//   - On non-2xx HTTP: ok=false, status set, data parsed if JSON, error from body.
//   - On 2xx: ok=true, status set, data is the parsed JSON (or null if empty).

export interface FetchJsonResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  networkError: boolean;
}

export async function fetchJSON<T = unknown>(
  input: string,
  init?: RequestInit
): Promise<FetchJsonResult<T>> {
  let resp: Response;
  try {
    resp = await fetch(input, init);
  } catch (e) {
    const msg = (e as Error).message || "网络请求失败 / Network request failed";
    // Browsers report "Failed to fetch" for server unreachable, offline, CORS,
    // DNS, or user navigation cancel. Treat them all as networkError=true.
    return {
      ok: false,
      status: 0,
      data: null,
      error: `无法连接到服务器 / Unable to reach server (${msg})。请确认开发服务已启动或刷新页面重试。`,
      networkError: true,
    };
  }

  // Server reached; try to parse body.
  let data: T | null = null;
  let parseError: string | null = null;
  try {
    const text = await resp.text();
    if (text.length > 0) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        parseError = text.slice(0, 200);
      }
    }
  } catch (e) {
    parseError = (e as Error).message;
  }

  if (!resp.ok) {
    const errMsg =
      (data && typeof data === "object" && "error" in data
        ? ((data as { error?: string }).error as string)
        : null) ??
      parseError ??
      `HTTP ${resp.status}`;
    return { ok: false, status: resp.status, data, error: errMsg, networkError: false };
  }

  return {
    ok: true,
    status: resp.status,
    data,
    error: parseError,
    networkError: false,
  };
}
