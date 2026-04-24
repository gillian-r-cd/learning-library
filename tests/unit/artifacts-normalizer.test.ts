import { describe, it, expect } from "vitest";
import {
  normalizeArtifact,
  normalizeContent,
  normalizeChallengeArtifacts,
} from "@/lib/skills/artifacts-normalizer";
import type { Challenge } from "@/lib/types/core";

describe("normalizeArtifact — defensive repair of Skill 3 output", () => {
  it("fills artifact_id when missing", () => {
    const a = normalizeArtifact(
      { name: "周报", type: "narrative", content: { body: "hi" }, trigger: "on_challenge_enter" },
      "c1_ch1",
      0
    );
    expect(a?.artifact_id).toBe("art_c1_ch1_0");
  });

  it("defaults trigger to on_challenge_enter when invalid", () => {
    const a = normalizeArtifact(
      { artifact_id: "art_a", name: "x", type: "narrative", content: { body: "x" }, trigger: "nonsense" },
      "c1",
      0
    );
    expect(a?.trigger).toBe("on_challenge_enter");
  });

  it("defaults version to 1 when missing", () => {
    const a = normalizeArtifact(
      { artifact_id: "art_a", name: "x", type: "narrative", content: { body: "x" }, trigger: "on_challenge_enter" },
      "c1",
      0
    );
    expect(a?.version).toBe(1);
  });

  it("falls back to narrative when type is invalid", () => {
    const a = normalizeArtifact(
      { artifact_id: "art_a", name: "x", type: "bogus", content: { body: "hello" }, trigger: "on_challenge_enter" },
      "c1",
      0
    );
    expect(a?.type).toBe("narrative");
    expect(a?.content.type).toBe("narrative");
  });

  it("wraps mismatched content back to narrative", () => {
    // type says "fields" but content is a plain string — should fall back to narrative
    const a = normalizeArtifact(
      {
        artifact_id: "art_a",
        name: "x",
        type: "fields",
        content: "just a plain string",
        trigger: "on_challenge_enter",
      },
      "c1",
      0
    );
    expect(a?.type).toBe("fields");
    if (a?.content.type === "fields") {
      expect(a.content.fields).toEqual([]);
    }
  });

  it("preserves a valid narrative content with header/body/footer", () => {
    const a = normalizeArtifact(
      {
        artifact_id: "art_mail",
        name: "辞职信",
        type: "narrative",
        content: {
          header: { from: "小陈", to: "你", date: "2026-04-22", subject: "个人事项" },
          body: "老板，我想谈谈...",
          footer: "2026-04-22 14:30",
        },
        trigger: "on_challenge_enter",
      },
      "c1",
      0
    );
    expect(a?.type).toBe("narrative");
    if (a?.content.type === "narrative") {
      expect(a.content.header?.from).toBe("小陈");
      expect(a.content.body).toContain("老板");
      expect(a.content.footer).toBe("2026-04-22 14:30");
    }
  });

  it("drops null input", () => {
    expect(normalizeArtifact(null, "c1", 0)).toBeNull();
  });
});

describe("normalizeContent — type-specific content repair", () => {
  it("fields: filters empty entries, preserves status", () => {
    const c = normalizeContent(
      "fields",
      {
        title: "员工档案",
        fields: [
          { key: "姓名", value: "陈雨", status: "filled" },
          { key: "", value: "x" }, // dropped
          { key: "入职日期", value: "2025-10", status: "empty" },
          { key: "备注", value: "", status: "weird" }, // status stripped
        ],
      },
      "fallback"
    );
    expect(c.type).toBe("fields");
    if (c.type === "fields") {
      expect(c.title).toBe("员工档案");
      expect(c.fields).toHaveLength(3);
      expect(c.fields?.[0]).toMatchObject({ key: "姓名", value: "陈雨", status: "filled" });
      expect(c.fields?.[2].status).toBeUndefined();
    }
  });

  it("series: keeps entries with text, drops empty text", () => {
    const c = normalizeContent(
      "series",
      {
        entries: [
          { timestamp: "W27", actor: "小陈", text: "提交初稿" },
          { timestamp: "W28", text: "" }, // dropped
          { text: "修订发布" },
        ],
      },
      "fallback"
    );
    expect(c.type).toBe("series");
    if (c.type === "series") {
      expect(c.entries).toHaveLength(2);
    }
  });

  it("list: default mode = bullet if invalid", () => {
    const c = normalizeContent(
      "list",
      { mode: "xyz", items: [{ text: "步骤 1" }, { text: "步骤 2", checked: true }] },
      "fallback"
    );
    expect(c.type).toBe("list");
    if (c.type === "list") {
      expect(c.mode).toBe("bullet");
      expect(c.items).toHaveLength(2);
    }
  });

  it("table: coerces row cell types, drops invalid columns", () => {
    const c = normalizeContent(
      "table",
      {
        title: "KPI",
        columns: [
          { key: "month", label: "月份" },
          { key: "", label: "invalid" }, // dropped
          { key: "sales" }, // label fallback = key
        ],
        rows: [
          { month: "2026-04", sales: 100 },
          { month: "2026-05", sales: "95", extra: "ignored" },
        ],
      },
      "fallback"
    );
    expect(c.type).toBe("table");
    if (c.type === "table") {
      expect(c.columns).toHaveLength(2);
      expect(c.columns[1].label).toBe("sales");
      expect(c.rows[0]).toEqual({ month: "2026-04", sales: 100 });
      expect(c.rows[1]).toEqual({ month: "2026-05", sales: "95" });
    }
  });

  it("hierarchy: recursively normalises children", () => {
    const c = normalizeContent(
      "hierarchy",
      {
        root: {
          label: "CEO",
          children: [
            { label: "CTO", children: [{ label: "Eng Mgr" }] },
            { label: "" }, // dropped
          ],
        },
      },
      "fallback"
    );
    expect(c.type).toBe("hierarchy");
    if (c.type === "hierarchy") {
      expect(c.root.label).toBe("CEO");
      expect(c.root.children).toHaveLength(1);
      expect(c.root.children?.[0].label).toBe("CTO");
      expect(c.root.children?.[0].children?.[0].label).toBe("Eng Mgr");
    }
  });

  it("narrative fallback: stringifies unknown content when body is missing", () => {
    const c = normalizeContent("narrative", { anything: "else" }, "TestArt");
    expect(c.type).toBe("narrative");
    if (c.type === "narrative") {
      expect(c.body.length).toBeGreaterThan(0);
    }
  });
});

describe("normalizeChallengeArtifacts — challenge-level wrapper", () => {
  it("leaves challenges without artifacts field untouched", () => {
    const ch: Challenge = {
      challenge_id: "c1_ch1",
      title: "t",
      binds_actions: ["a1"],
      complexity: "low",
      trunk: { setup: "s", action_prompts: [], expected_signals: [] },
      companion_hooks: [],
    };
    const out = normalizeChallengeArtifacts(ch);
    expect(out.artifacts).toBeUndefined();
  });

  it("normalizes every artifact and drops null entries", () => {
    const ch = {
      challenge_id: "c1_ch1",
      title: "t",
      binds_actions: ["a1"],
      complexity: "low" as const,
      trunk: { setup: "", action_prompts: [], expected_signals: [] },
      companion_hooks: [],
      artifacts: [
        { name: "周报", type: "fields", content: { fields: [{ key: "人员", value: "小陈" }] }, trigger: "on_challenge_enter" },
        null,
        { name: "组织图", type: "hierarchy", content: { root: { label: "CEO" } }, trigger: "on_learner_request" },
      ],
    };
    const out = normalizeChallengeArtifacts(ch as unknown as Challenge);
    expect(out.artifacts).toHaveLength(2);
    expect(out.artifacts![0].type).toBe("fields");
    expect(out.artifacts![1].artifact_id).toBe("art_c1_ch1_2");
    expect(out.artifacts![1].trigger).toBe("on_learner_request");
  });
});
