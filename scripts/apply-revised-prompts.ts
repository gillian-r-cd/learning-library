// Parse `docs/all_prompts_revised.md` and publish each section as a NEW
// system-level version of the corresponding prompt key. The previous
// published version is automatically marked `rolled_back` (handled by
// upsertPrompt). All historical versions are preserved.
//
// Run: `npm run apply-revised-prompts [-- --file=docs/all_prompts_revised.md]`

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { upsertPrompt } from "../lib/prompt-store";
import { listBuiltinKeys } from "../lib/prompt-store/seed";
import type { PromptBody } from "../lib/prompt-store/render";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface ParsedSection {
  key: string;
  model: string;
  temperature: number;
  maxTokens: number;
  system: string;
  userMessage: string;
  startLine: number;
}

function parseFile(filePath: string): ParsedSection[] {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const sections: ParsedSection[] = [];

  // Find every section header line.
  const headerIdx: { idx: number; key: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+`([\w_]+)\.template`/);
    if (m) headerIdx.push({ idx: i, key: m[1] });
  }
  if (headerIdx.length === 0) {
    throw new Error("No `## \\`<key>.template\\`` headers found in file.");
  }

  for (let s = 0; s < headerIdx.length; s++) {
    const start = headerIdx[s].idx;
    const end = s + 1 < headerIdx.length ? headerIdx[s + 1].idx : lines.length;
    const slice = lines.slice(start, end);
    sections.push(parseSection(headerIdx[s].key, slice, start));
  }
  return sections;
}

function parseSection(key: string, lines: string[], startLine: number): ParsedSection {
  // Metadata: bullets like `- **model**: \`claude-opus-4-7\``
  const meta = extractMeta(lines);
  const system = extractFencedBlockAfter(lines, /^### System Prompt\s*$/);
  const userMessage = extractFencedBlockAfter(lines, /^### User Message Template\s*$/);
  if (system == null) {
    throw new Error(`[${key}] Missing System Prompt fenced block (around line ${startLine + 1}).`);
  }
  if (userMessage == null) {
    throw new Error(
      `[${key}] Missing User Message Template fenced block (around line ${startLine + 1}).`
    );
  }
  return {
    key,
    model: meta.model,
    temperature: meta.temperature,
    maxTokens: meta.maxTokens,
    system,
    userMessage,
    startLine,
  };
}

function extractMeta(lines: string[]): {
  model: string;
  temperature: number;
  maxTokens: number;
} {
  const pat = (label: string) =>
    new RegExp(String.raw`^-\s+\*\*${label}\*\*:\s*\`([^\`]+)\``);
  let model: string | null = null;
  let temperature: string | null = null;
  let maxTokens: string | null = null;
  for (const line of lines) {
    const mModel = line.match(pat("model"));
    if (mModel) model = mModel[1];
    const mTemp = line.match(pat("temperature"));
    if (mTemp) temperature = mTemp[1];
    const mMax = line.match(pat("max_tokens"));
    if (mMax) maxTokens = mMax[1];
    if (model && temperature && maxTokens) break;
  }
  if (!model || !temperature || !maxTokens) {
    throw new Error(
      `Missing one of model/temperature/max_tokens. Got: model=${model} temperature=${temperature} max_tokens=${maxTokens}`
    );
  }
  const t = Number(temperature);
  const mt = Number(maxTokens);
  if (Number.isNaN(t) || Number.isNaN(mt)) {
    throw new Error(`Bad numeric meta: temperature=${temperature} max_tokens=${maxTokens}`);
  }
  return { model, temperature: t, maxTokens: mt };
}

/**
 * Find the first fenced block AFTER a header line matching `headerRe`.
 * Supports markdown extended fences (3+ backticks) — the closing fence must
 * have the same length as the opening one.
 *
 * The walker tolerates free-form annotation lines between the heading and the
 * opening fence (e.g. "（与原文相同，不需要改动）") — anything that isn't
 * itself a fence is skipped, until either the fence appears or another
 * `### ...` / `## ...` header begins (in which case we abort: no block).
 */
function extractFencedBlockAfter(lines: string[], headerRe: RegExp): string | null {
  let i = 0;
  while (i < lines.length && !headerRe.test(lines[i])) i++;
  if (i >= lines.length) return null;
  i++;
  // Walk past blank lines + free-form annotation until we either find the
  // opening fence, or run into the next ### / ## heading (abort).
  while (i < lines.length) {
    const line = lines[i];
    if (/^(`{3,})\s*([\w-]*)\s*$/.test(line)) break; // found fence
    if (/^#{2,}\s+/.test(line)) return null; // ran past into next heading
    i++;
  }
  if (i >= lines.length) return null;
  const open = lines[i].match(/^(`{3,})\s*([\w-]*)\s*$/);
  if (!open) return null;
  const fenceLen = open[1].length;
  i++;
  const buf: string[] = [];
  while (i < lines.length) {
    const close = lines[i].match(/^(`{3,})\s*$/);
    if (close && close[1].length >= fenceLen) {
      return buf.join("\n");
    }
    buf.push(lines[i]);
    i++;
  }
  return null; // unterminated fence
}

function main() {
  const args = process.argv.slice(2);
  const fileArg = args.find((a) => a.startsWith("--file="))?.split("=")[1];
  const inputPath = fileArg
    ? path.resolve(ROOT, fileArg)
    : path.join(ROOT, "docs", "all_prompts_revised.md");
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }
  console.log(`Parsing ${path.relative(ROOT, inputPath)} ...`);
  const sections = parseFile(inputPath);

  // Validate every parsed key maps to a known builtin so the operator catches
  // typos before mutating the DB.
  const builtinKeys = new Set(listBuiltinKeys().map((b) => b.key));
  const parsedKeys = new Set<string>();
  for (const s of sections) {
    const fullKey = `${s.key}.template`;
    if (!builtinKeys.has(fullKey)) {
      console.error(
        `[abort] Section header for unknown key: \`${s.key}.template\` (line ${s.startLine + 1}).`
      );
      console.error(`Known keys: ${Array.from(builtinKeys).join(", ")}`);
      process.exit(1);
    }
    if (parsedKeys.has(fullKey)) {
      console.error(`[abort] Duplicate section for key: \`${fullKey}\` (line ${s.startLine + 1}).`);
      process.exit(1);
    }
    parsedKeys.add(fullKey);
  }

  // Warn (don't block) if some builtin keys are missing from the file.
  const missing = Array.from(builtinKeys).filter((k) => !parsedKeys.has(k));
  if (missing.length > 0) {
    console.warn(`[warn] These builtin keys are NOT in the file (will be left untouched):`);
    for (const m of missing) console.warn(`         - ${m}`);
  }

  // Apply each section.
  const results: { key: string; version: number }[] = [];
  for (const s of sections) {
    const fullKey = `${s.key}.template`;
    const body: PromptBody = {
      system: s.system,
      messages: [{ role: "user", content: s.userMessage }],
      temperature: s.temperature,
      max_tokens: s.maxTokens,
      model: s.model,
    };
    const r = upsertPrompt({
      key: fullKey,
      scope: "system",
      status: "published",
      body,
      created_by: "docs/all_prompts_revised.md",
      note: `applied from docs/all_prompts_revised.md (md line ${s.startLine + 1})`,
    });
    results.push({ key: fullKey, version: r.version });
    console.log(`  ✓ ${fullKey} → v${r.version}`);
  }
  console.log(`\nDone. Published ${results.length} prompts as new versions. All prior versions preserved as rolled_back.`);
}

main();
