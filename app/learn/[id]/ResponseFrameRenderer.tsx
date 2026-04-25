"use client";

import { useEffect, useMemo, useState } from "react";
import type { ResponseField, ResponseFrame } from "@/lib/types/core";

export interface ResponseFrameSubmit {
  frame_id: string;
  frame_version: number;
  values: Record<string, unknown>;
}

export default function ResponseFrameRenderer({
  frame,
  busy,
  onSubmit,
}: {
  frame: ResponseFrame;
  busy: boolean;
  onSubmit: (response: ResponseFrameSubmit, optimisticText: string) => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    setValues(initialValues(frame));
  }, [frame.frame_id, frame.version]);

  const canSubmit = useMemo(
    () => frame.fields.every((f) => !f.required || !isEmpty(values[f.field_id])),
    [frame.fields, values]
  );

  function setValue(fieldId: string, value: unknown) {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  function submit() {
    if (busy || !canSubmit) return;
    const submittedValues = values;
    onSubmit(
      {
        frame_id: frame.frame_id,
        frame_version: frame.version,
        values: submittedValues,
      },
      optimisticText(frame, submittedValues)
    );
    setValues(resetValuesAfterSubmit(frame, submittedValues));
  }

  return (
    <div className="border-t border-border/80 p-4 space-y-3 bg-bg/55 backdrop-blur" data-test-id="response-frame">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="chip !border-accent/40 !text-accent">{frame.kind === "free_text" ? "自由回答" : "行动框架"}</span>
          <div className="font-semibold text-sm">{frame.title}</div>
        </div>
        <div className="text-xs text-muted">{frame.prompt}</div>
        {frame.helper_text && <div className="text-xs text-accent">{frame.helper_text}</div>}
      </div>

      <div className={frame.kind === "free_text" ? "flex gap-2" : "space-y-3"}>
        <div className={frame.kind === "free_text" ? "flex-1" : "space-y-3"}>
          {frame.fields.map((field) => (
            <FieldControl
              key={field.field_id}
              field={field}
              value={values[field.field_id]}
              busy={busy}
              compact={frame.kind === "free_text"}
              onChange={(value) => setValue(field.field_id, value)}
              onSubmit={submit}
            />
          ))}
        </div>
        <button
          className="btn-primary min-w-20 rounded-xl"
          onClick={submit}
          data-test-id="learner-send"
          disabled={busy || !canSubmit}
        >
          {busy ? "推进中..." : frame.submit_label ?? "提交行动"}
        </button>
      </div>
    </div>
  );
}

function FieldControl({
  field,
  value,
  busy,
  compact,
  onChange,
  onSubmit,
}: {
  field: ResponseField;
  value: unknown;
  busy: boolean;
  compact: boolean;
  onChange: (value: unknown) => void;
  onSubmit: () => void;
}) {
  if (field.type === "textarea") {
    return (
      <label className={compact ? "block" : "block space-y-1"}>
        {!compact && <span className="label">{field.label}</span>}
        <textarea
          className="input min-h-[48px] rounded-xl"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? field.label}
          data-test-id={compact ? "learner-input" : `response-field-${field.field_id}`}
          disabled={busy}
          onKeyDown={(e) => {
            if (compact && e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        {field.help_text && <span className="text-xs text-muted">{field.help_text}</span>}
      </label>
    );
  }

  if (field.type === "radio" || field.type === "select") {
    return (
      <div className="space-y-1">
        <div className="label">{field.label}</div>
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`btn text-xs rounded-full ${value === opt.value ? "!border-accent !text-accent !bg-accent/10" : ""}`}
              onClick={() => onChange(opt.value)}
              disabled={busy}
              data-test-id={`response-option-${field.field_id}-${opt.value}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === "checkboxes" || field.type === "chips") {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return (
      <div className="space-y-1">
        <div className="label">{field.label}</div>
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((opt) => {
            const active = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                className={`btn text-xs rounded-full ${active ? "!border-accent !text-accent !bg-accent/10" : ""}`}
                onClick={() =>
                  onChange(
                    active
                      ? selected.filter((v) => v !== opt.value)
                      : [...selected, opt.value]
                  )
                }
                disabled={busy}
                data-test-id={`response-option-${field.field_id}-${opt.value}`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <label className="block space-y-1">
      <span className="label">{field.label}</span>
      <input
        className="input rounded-xl"
        value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
        type={field.type === "number" ? "number" : "text"}
        onChange={(e) => onChange(field.type === "number" ? Number(e.target.value) : e.target.value)}
        placeholder={field.placeholder ?? field.label}
        data-test-id={`response-field-${field.field_id}`}
        disabled={busy}
      />
    </label>
  );
}

function initialValues(frame: ResponseFrame): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of frame.fields) {
    if (field.type === "checkboxes" || field.type === "chips") out[field.field_id] = [];
    else out[field.field_id] = "";
  }
  return out;
}

export function resetValuesAfterSubmit(
  frame: ResponseFrame,
  _submittedValues: Record<string, unknown>
): Record<string, unknown> {
  return initialValues(frame);
}

function optimisticText(frame: ResponseFrame, values: Record<string, unknown>): string {
  if (frame.kind === "free_text") {
    const first = frame.fields[0]?.field_id;
    const value = first ? values[first] : "";
    return typeof value === "string" ? value : "";
  }
  return `（已提交：${frame.title}）`;
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
