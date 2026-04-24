import { describe, it, expect, beforeEach, vi } from "vitest";
import { fetchJSON } from "@/lib/client/fetchJson";

describe("fetchJSON — robust network error handling", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = originalFetch;
  });

  it("returns networkError=true when fetch throws (server unreachable)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const r = await fetchJSON("/api/foo", { method: "POST" });
    expect(r.ok).toBe(false);
    expect(r.networkError).toBe(true);
    expect(r.status).toBe(0);
    expect(r.error).toMatch(/无法连接|Unable to reach/);
  });

  it("parses JSON body on 200", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ hello: "world" }),
    } as unknown as Response);
    const r = await fetchJSON<{ hello: string }>("/api/foo");
    expect(r.ok).toBe(true);
    expect(r.data?.hello).toBe("world");
    expect(r.networkError).toBe(false);
  });

  it("treats 4xx as api error (not network error)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: "bad input" }),
    } as unknown as Response);
    const r = await fetchJSON<{ error: string }>("/api/foo");
    expect(r.ok).toBe(false);
    expect(r.networkError).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toBe("bad input");
    expect(r.data?.error).toBe("bad input");
  });

  it("handles empty body gracefully", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: async () => "",
    } as unknown as Response);
    const r = await fetchJSON("/api/foo");
    expect(r.ok).toBe(true);
    expect(r.data).toBeNull();
  });

  it("handles non-JSON body gracefully", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<html>not json</html>",
    } as unknown as Response);
    const r = await fetchJSON("/api/foo");
    expect(r.ok).toBe(true);
    expect(r.data).toBeNull();
    expect(r.error).toContain("html");
  });
});
