# Learner Response Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Schema-driven learner response frames so the learner UI can render natural-language, choice, and form inputs from Blueprint/runtime data.

**Architecture:** Extend Blueprint `Challenge` with `response_frames`, normalize every challenge to include `free_text`, expose active frames in `Snapshot`, accept structured `response` in `/api/learning/turn`, canonicalize it for existing Judge prompts, persist original structured values in `conversation_log.meta`, and render frames with fixed React components. Judge may choose the next frame by `frame_id`, but cannot invent field structure at runtime.

**Tech Stack:** Next.js App Router, React 19, TypeScript, SQLite via `better-sqlite3`, Vitest.

---

### Task 1: Response Frame Core Types and Normalizer

**Files:**
- Modify: `lib/types/core.ts`
- Create: `lib/learning-runtime/response-frames.ts`
- Test: `tests/unit/response-frames.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:
- missing frames produce a `free_text_default`
- invalid Judge-selected frame falls back to default
- structured form values canonicalize into stable text
- required validation rejects missing values

- [ ] **Step 2: Run red test**

Run: `npx vitest run tests/unit/response-frames.test.ts`

Expected: fail because module/types do not exist.

- [ ] **Step 3: Implement minimal types and helpers**

Add `ResponseFrame`, `ResponseField`, `LearnerStructuredResponse`, `NextResponseFrameSelection`; add normalizer/validator/canonicalizer helpers.

- [ ] **Step 4: Run green test**

Run: `npx vitest run tests/unit/response-frames.test.ts`

Expected: pass.

### Task 2: Snapshot and RunTurn Integration

**Files:**
- Modify: `lib/state-manager/index.ts`
- Modify: `lib/learning-runtime/index.ts`
- Modify: `app/api/learning/turn/route.ts`
- Test: `tests/unit/learning-runtime.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:
- `buildSnapshot` returns current challenge frames and active frame
- `runTurn` accepts structured `response`, persists `meta.kind = learner_response`, and sends canonical text through the turn result

- [ ] **Step 2: Run red tests**

Run: `npx vitest run tests/unit/learning-runtime.test.ts`

Expected: fail because snapshot/turn response-frame fields are absent.

- [ ] **Step 3: Implement minimal runtime integration**

Normalize structured input at the API/runtime boundary, append learner conversation with structured meta, and include response frame data in snapshot.

- [ ] **Step 4: Run green tests**

Run: `npx vitest run tests/unit/learning-runtime.test.ts`

Expected: pass.

### Task 3: Judge Selection Field

**Files:**
- Modify: `lib/types/core.ts`
- Modify: `lib/judge/index.ts`
- Test: `tests/unit/judge-normalizer.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:
- valid `next_response_frame.frame_id` survives normalization
- malformed selection becomes `null`

- [ ] **Step 2: Run red test**

Run: `npx vitest run tests/unit/judge-normalizer.test.ts`

Expected: fail because `next_response_frame` is dropped.

- [ ] **Step 3: Implement minimal normalizer support**

Normalize `next_response_frame` as optional data only; runtime activation can use the normalized value in Task 4.

- [ ] **Step 4: Run green test**

Run: `npx vitest run tests/unit/judge-normalizer.test.ts`

Expected: pass.

### Task 4: Learner UI Renderer

**Files:**
- Create: `app/learn/[id]/ResponseFrameRenderer.tsx`
- Modify: `app/learn/[id]/LearnerSession.tsx`
- Test: `tests/e2e/02-learner.spec.ts`

- [ ] **Step 1: Write failing E2E assertion**

Cover:
- learner page renders a free-text response frame by default
- structured form frame can be displayed from snapshot data and submitted

- [ ] **Step 2: Run red E2E**

Run: `npx playwright test tests/e2e/02-learner.spec.ts`

Expected: fail because renderer/test IDs do not exist.

- [ ] **Step 3: Implement fixed renderers**

Implement `free_text`, `single_choice`, `multi_choice`, and `form`; use existing `input`, `btn`, and card styles.

- [ ] **Step 4: Run green E2E**

Run: `npx playwright test tests/e2e/02-learner.spec.ts`

Expected: pass.

### Task 5: Skill 3 Normalization and Final Verification

**Files:**
- Modify: `lib/skills/index.ts`
- Modify: `lib/prompt-store/seed.ts`
- Test: `tests/unit/skill3-fill-validation.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:
- normalized Skill 3 challenge always includes `free_text_default`
- generated form fields survive challenge normalization

- [ ] **Step 2: Run red test**

Run: `npx vitest run tests/unit/skill3-fill-validation.test.ts`

Expected: fail because response frames are not normalized.

- [ ] **Step 3: Implement Skill 3 support**

Normalize `response_frames` in every filled challenge and update seed prompt schema to tell the model to emit frames.

- [ ] **Step 4: Run full verification**

Run:
- `npm run test:unit`
- `npx tsc --noEmit`
- targeted E2E: `npx playwright test tests/e2e/02-learner.spec.ts`

Expected: all pass.

