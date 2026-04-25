import { describe, expect, it } from "vitest";
import type { ResponseFrame } from "@/lib/types/core";
import {
  formatStructuredSubmission,
  optimisticText,
  resetValuesAfterSubmit,
  shouldCollapseAfterSubmit,
} from "@/app/learn/[id]/ResponseFrameRenderer";

describe("ResponseFrameRenderer helpers", () => {
  it("clears submitted field values back to the frame defaults", () => {
    const frame: ResponseFrame = {
      frame_id: "rf_free_text",
      version: 1,
      kind: "free_text",
      title: "自由回答",
      prompt: "说说你的判断",
      binds_actions: ["a1"],
      fields: [
        {
          field_id: "text",
          type: "textarea",
          label: "你的回复",
          required: true,
        },
      ],
    };

    expect(resetValuesAfterSubmit(frame, { text: "已经发出的内容" })).toEqual({
      text: "",
    });
  });

  it("formats structured submissions with field labels and option labels", () => {
    const frame: ResponseFrame = {
      frame_id: "rf_form",
      version: 1,
      kind: "form",
      title: "渴望拆解单",
      prompt: "拆开填写。",
      binds_actions: ["a1"],
      fields: [
        { field_id: "cue", type: "text", label: "提示", required: true },
        {
          field_id: "reward",
          type: "radio",
          label: "奖励",
          required: true,
          options: [
            { value: "energy", label: "更有精神" },
            { value: "calm", label: "更安稳" },
          ],
        },
        {
          field_id: "barriers",
          type: "checkboxes",
          label: "阻碍",
          options: [
            { value: "phone", label: "手机" },
            { value: "late", label: "太晚" },
          ],
        },
      ],
    };

    expect(
      formatStructuredSubmission(frame, {
        cue: "晚饭后坐到沙发上",
        reward: "calm",
        barriers: ["phone", "late"],
      })
    ).toBe("我的提交：渴望拆解单\n- 提示：晚饭后坐到沙发上\n- 奖励：更安稳\n- 阻碍：手机、太晚");
  });

  it("keeps free text as plain optimistic text but collapses structured frames after submit", () => {
    const freeText: ResponseFrame = {
      frame_id: "rf_free_text",
      version: 1,
      kind: "free_text",
      title: "自由回答",
      prompt: "说说你的判断",
      binds_actions: ["a1"],
      fields: [{ field_id: "text", type: "textarea", label: "你的回复", required: true }],
    };
    const form: ResponseFrame = {
      ...freeText,
      frame_id: "rf_form",
      kind: "form",
      title: "结构表单",
    };

    expect(optimisticText(freeText, { text: "我的自然语言回答" })).toBe("我的自然语言回答");
    expect(shouldCollapseAfterSubmit(freeText)).toBe(false);
    expect(shouldCollapseAfterSubmit(form)).toBe(true);
  });
});
