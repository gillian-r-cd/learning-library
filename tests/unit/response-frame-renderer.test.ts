import { describe, expect, it } from "vitest";
import type { ResponseFrame } from "@/lib/types/core";
import { resetValuesAfterSubmit } from "@/app/learn/[id]/ResponseFrameRenderer";

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
});
