# Execution Quality and API Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve model input fidelity and materially improve ovll execution quality while keeping normal Gemini request count flat or lower and placing hard bounds on retries, fallback, finalization, and cancellation leakage.

**Architecture:** Keep the existing planner, RuntimeEngine, browser API adapter, and `geminiExecution.js` execution path. Make the browser API adapter the canonical owner of outbound execution payload shaping/measurement, let RuntimeEngine consume that measurement through an injected callback, isolate final-response policy into one small browser module, and isolate HTTP abort binding into one small server utility so both policies are directly testable.

**Tech Stack:** Browser JavaScript IIFEs, Node.js ESM, Express 5, Node built-in test runner, Gemini Interactions REST API.

**Spec:** `docs/superpowers/specs/2026-10-05-execution-quality-api-budget-design.md`

## Global Constraints

- Keep default execution model `gemini-3.5-flash-lite`.
- Keep fallback model `gemini-3.1-flash-lite` only for model availability/unsupported-model failures.
- Do not add live web search, paid grounding, stateful Gemini storage, or a second execution path.
- Normal successful execution must use the same or fewer Gemini requests for the same workflow.
- Structured execution text must preserve LF newlines and indentation; only intentional metadata fields may collapse whitespace.
- Uploaded/source content is limited by the total execution request budget, not by the current accidental deep-string `3000` character cap.
- Simple `organize`/`convert` groups use `minimal` thinking; any group containing `research`, `write`, or `judge` uses `low`; `medium`/`high` are never selected automatically by this change.
- HTTP 429, network errors, and retryable 5xx receive at most one same-model retry; 429 never triggers fallback.
- Structured semantic mismatch receives at most one same-model repair request.
- Cancellation is non-retryable and must prevent retry, repair, fallback, and finalization.
- Do not log raw prompts, memory text, uploaded content, or generated document bodies.
- Every deployed code update must bump `server.js` `APP_VERSION`.
- If a new browser shell script is added, rotate the service-worker shell cache and include the script in both bootstrap and precache lists.

## Review Focus

- A deeply nested multiline source containing Markdown/code plus a long tail must preserve line structure and the tail marker instead of being flattened or silently cut to 3000 characters; Task 1 adds this test.
- A cached node adjacent to the pivot must not allow the pivot itself to be reused and must still batch the remaining consecutive misses maximally; Task 2 adds this test.
- A request aborted while waiting after a 429/5xx must not start the scheduled retry; Task 3 adds this test.
- A normal HTTP response closing after completion must not be mistaken for client cancellation; Task 4 adds this test.
- A single terminal Gemini node whose `outputs.result` is structured JSON rather than a usable string must still use model synthesis instead of emitting `[object Object]` or bypassing finalization; Task 5 adds this test.

---

### Task 1: Preserve execution payload structure and measure the actual outbound request

**Files:**
- Modify: `front/js/api.js`
- Create: `test/apiExecution.test.js`

**Interfaces:**
- Produces: `AstraAPI.buildExecutionPayload(group, context)` returning the exact body used by `executeGroup()`.
- Produces: `AstraAPI.measureExecutionPayloadChars(group, context)` returning `JSON.stringify(buildExecutionPayload(...)).length`.
- Preserves: existing `AstraAPI.executeGroup(group, context, options)` call surface.

- [ ] **Step 1: Write failing payload-fidelity tests**

Create `test/apiExecution.test.js` by evaluating `front/js/api.js` with a fake `window` and fake `fetch`. Add tests asserting:
- `buildExecutionPayload()` preserves `"## 제목\n\n- 하나\n- 둘"` exactly except CRLF→LF normalization.
- nested code text such as `"function x() {\n  return 1;\n}"` retains indentation.
- `context.userRequest` and memory fields remain intentionally compact single-line metadata.
- a nested `file.text` longer than 3000 characters is not cut at 3000 when the total body remains under the execution budget.
- long structured text truncation preserves a head segment, a tail segment, and an explicit omission marker.
- `executeGroup()` sends exactly the body returned by `buildExecutionPayload()`.

- [ ] **Step 2: Run the new tests and verify the current implementation fails**

Run: `node --test test/apiExecution.test.js`

Expected: FAIL on newline/indentation preservation and deep nested string length.

- [ ] **Step 3: Split metadata compaction from structured-content compaction in `front/js/api.js`**

Implement:
- `clipMetadataText(value, max)`: collapse whitespace, trim, preserve current head/tail behavior.
- `clipStructuredText(value, max)`: normalize CRLF→LF, remove NUL, preserve newlines/tabs/indentation, trim only outer excess, and use head/tail omission when capped.
- `compactExecutionValue(value, budget, depth)`: default arbitrary execution strings to `clipStructuredText`; never choose a smaller cap solely because nesting depth increased.
- Keep artifact-specific compaction separate from execution payload shaping.

Use metadata compaction only for IDs/types, `userRequest`, and normalized memory fields.

- [ ] **Step 4: Implement one canonical browser execution body builder**

Add `buildExecutionPayload(group, context)` and make `executeGroup()` call it directly. Allocate the fixed 42000-character Gemini group budget by reserving space for:
- IDs/types/connections
- compact user request
- compact memory

Use the remaining budget for params/inputs, prioritizing source/input strings over repeated metadata. If a single string must be shortened, preserve head/tail and the omission marker.

Add `measureExecutionPayloadChars(group, context)` over the exact built body.

- [ ] **Step 5: Run the focused tests**

Run: `node --test test/apiExecution.test.js`

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add front/js/api.js test/apiExecution.test.js
git commit -m "fix: preserve structured Gemini execution input"
```

### Task 2: Make cache reuse semantically correct and regroup cache misses

**Files:**
- Modify: `front/js/runtimeEngine.js`
- Modify: `front/js/app.js`
- Test: `test/runtimeEngine.test.js`

**Interfaces:**
- RuntimeEngine constructor gains optional `measureGroupInputChars(group, context) -> number`.
- `RuntimeEngine.run(..., { cacheContext })` receives normalized `memory` in addition to conversation ID/user request.
- Cache fingerprint adds a fixed `EXECUTION_CACHE_POLICY_VERSION`.

- [ ] **Step 1: Replace the existing cache expectation with failing maximal-segment tests**

In `test/runtimeEngine.test.js`, update the current `"unchanged intermediate results are reused but param changes invalidate cache"` expectation and add cases proving:
- `A -> B -> C -> D -> E` with only C cached executes `[A,B]`, reuses C, then executes `[D,E]`.
- adjacent A/B cache hits execute the remaining `[C,D,E]` once.
- pivot is always recomputed even if a matching cache entry exists.
- changing normalized memory invalidates cached Gemini results.
- changing user request, params, or collected inputs still invalidates cache.

- [ ] **Step 2: Run runtime tests and confirm failure**

Run: `node --test test/runtimeEngine.test.js`

Expected: FAIL because partial cache hits currently force one-node execution and memory is not part of the app cache context.

- [ ] **Step 3: Add cache policy identity and memory context**

In `front/js/runtimeEngine.js`:
- define `EXECUTION_CACHE_POLICY_VERSION = "execution-quality-v1"`.
- include the policy version plus the complete stable `cacheContext` in `executionFingerprint()`.
- keep volatile run IDs/timestamps out of the fingerprint.

In `front/js/app.js`, pass:
- `conversationId`
- `userRequest`
- normalized current `memory`

inside `cacheContext` on runtime execution.

- [ ] **Step 4: Replace the partial-cache one-node loop with maximal miss segmentation**

For each planned Gemini group:
- walk node IDs in dependency order
- resolve valid cache hits against current inputs
- commit cache hits locally
- split non-cached IDs into maximal consecutive segments separated only by cache hits
- call existing `executeIds(segment)` once per segment
- preserve existing failure/skip behavior within each executed segment

Do not alter judge isolation, fork/merge boundaries, or pivot invalidation.

- [ ] **Step 5: Use the canonical browser payload measurement before dispatch**

Store optional `measureGroupInputChars` from the RuntimeEngine constructor.

Before dispatching a multi-node segment, measure the complete group plus `cacheContext.userRequest` and `cacheContext.memory`. If over the 42000-character limit, split into maximal consecutive subsegments that fit. If one node alone remains over budget, let the server return the typed oversized-input error rather than silently deleting most source content.

In `front/js/app.js`, inject a measurement callback backed by `API.measureExecutionPayloadChars()`.

- [ ] **Step 6: Run runtime and payload tests**

Run: `node --test test/runtimeEngine.test.js test/apiExecution.test.js`

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add front/js/runtimeEngine.js front/js/app.js test/runtimeEngine.test.js
git commit -m "fix: regroup cached Gemini execution segments"
```

### Task 3: Separate Gemini thinking, retry, repair, fallback, abort, and usage policies

**Files:**
- Modify: `geminiExecution.js`
- Test: `test/geminiExecution.test.js`

**Interfaces:**
- `createGeminiExecution().executeGroup(input, { signal } = {})`
- `createGeminiExecution().finalizeRun(input, { signal } = {})`
- Execution/finalizer results add `diagnostics`.
- `normalizeUsage()` adds `cachedTokens`, `thoughtTokens`, and `toolUseTokens`.

**Diagnostics shape:**
```js
{
  stage: "execution" | "finalizer",
  thinkingLevel: "minimal" | "low" | "medium" | "high",
  models: string[],
  primaryAttempts: number,
  transientRetries: number,
  repairAttempts: number,
  fallbackAttempts: number,
  fallbackUsed: boolean,
  durationMs: number
}
```

- [ ] **Step 1: Add failing deterministic policy tests**

Extend `test/geminiExecution.test.js` with assertions that:
- organize-only/convert-only groups send `thinking_level:"minimal"`.
- any group containing research/write/judge sends `thinking_level:"low"`.
- explicit `GEMINI_THINKING_LEVEL`/constructor override still forces the configured valid level for diagnostics.
- semantic mismatch causes exactly one repair request on the same model and never fallback.
- network/5xx causes at most one same-model retry.
- 429 honors `Retry-After`, allows at most one same-model retry, and never switches model.
- unsupported/unavailable primary model may use one fallback request.
- fallback does not receive a fresh multi-retry budget.
- abort before or during retry delay prevents every later request.
- `normalizeUsage()` maps `total_cached_tokens`, `total_thought_tokens`, and `total_tool_use_tokens`.
- diagnostics counters match the actual fake-fetch call sequence.

- [ ] **Step 2: Run the Gemini tests and verify failures**

Run: `node --test test/geminiExecution.test.js`

Expected: FAIL on current global-minimal thinking, broad fallback eligibility, 3-attempt retry loop, missing abort support, and missing usage fields.

- [ ] **Step 3: Implement deterministic thinking selection**

Add a pure `selectThinkingLevel(nodes, forcedLevel)`:
- forced valid level wins when explicitly configured
- otherwise research/write/judge → low
- otherwise organize/convert → minimal
- finalizer defaults to minimal unless the explicit diagnostic override is present

Pass the selected level into each request builder instead of closing over one global production level.

- [ ] **Step 4: Replace the generic attempt loop with explicit stage budgets**

Implement request flow with distinct counters:
- normal primary request
- optional one same-model transient retry for network/429/5xx
- optional one same-model semantic repair after a successful HTTP response with invalid structured output
- optional one fallback request only when the primary model is unsupported/unavailable

Do not grant fallback a new retry loop. Do not fallback for 429, 5xx, network errors, refusal, or semantic mismatch.

For finalizer, use the primary model with the same bounded transient/repair behavior and fall back to the app's local final message instead of cascading through model fallback.

- [ ] **Step 5: Add AbortSignal support through fetch and retry waits**

Accept `options.signal` in both public methods.

Before every request/repair/fallback and after every retry delay, throw a typed non-retryable cancellation error when aborted. Pass `signal` to the Gemini `fetch`. Make retry sleep abortable so a cancellation during `Retry-After` does not wait and then fire another request.

- [ ] **Step 6: Extend usage normalization and diagnostics without content logging**

Map the extra usage fields and return the diagnostics object alongside `model`, `usage`, and result/message. Diagnostics contain only counters/model names/timing/thinking level, never prompt or generated content.

- [ ] **Step 7: Run the focused Gemini suite**

Run: `node --test test/geminiExecution.test.js`

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add geminiExecution.js test/geminiExecution.test.js
git commit -m "fix: bound Gemini execution escalation"
```

### Task 4: Propagate HTTP cancellation to Gemini and expose safe diagnostics

**Files:**
- Create: `requestAbort.js`
- Modify: `server.js`
- Create: `test/requestAbort.test.js`

**Interfaces:**
- `bindRequestAbort(req, res) -> { signal, cleanup }`
- Server calls `geminiExecution.executeGroup(input, { signal })` and `finalizeRun(input, { signal })`.

- [ ] **Step 1: Write failing lifecycle tests**

Create `test/requestAbort.test.js` using EventEmitter-based fake request/response objects. Assert:
- `req.emit("aborted")` aborts the returned signal.
- `res.emit("close")` aborts only when the response has not completed.
- `res.writableEnded = true` followed by `close` does not mark a successful request cancelled.
- `cleanup()` removes listeners and is idempotent.

- [ ] **Step 2: Run the lifecycle tests and verify failure**

Run: `node --test test/requestAbort.test.js`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement `bindRequestAbort()`**

Create one `AbortController` per request. Listen for request abort and premature response close. Return its signal plus explicit listener cleanup.

No timers, retries, or Gemini policy belong in this module.

- [ ] **Step 4: Wire both Gemini HTTP endpoints through the abort context**

In `server.js`:
- bind the request before execution
- pass `signal` to `executeGroup`/`finalizeRun`
- always call `cleanup()` in `finally`
- if cancellation happens before a response can be written, avoid attempting a second error response
- include safe usage/diagnostics fields in existing server logs
- return `diagnostics` in successful API JSON for internal browser diagnostics

Do not log request bodies.

- [ ] **Step 5: Run cancellation and Gemini tests**

Run: `node --test test/requestAbort.test.js test/geminiExecution.test.js`

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add requestAbort.js server.js test/requestAbort.test.js
git commit -m "fix: propagate runtime cancellation upstream"
```

### Task 5: Make final synthesis conditional and directly testable

**Files:**
- Create: `front/js/runtimeFinalization.js`
- Modify: `front/js/app.js`
- Modify: `front/js/boot.js`
- Modify: `front/sw.js`
- Create: `test/runtimeFinalization.test.js`
- Test: `test/uiArchitecture.test.js`

**Interfaces:**
- Browser global `OvllRuntimeFinalization.decide(run)`.
- Return shape: `{ mode: "skip" | "local" | "model", reason: string, message: string }`.

- [ ] **Step 1: Write failing finalization policy tests**

Create `test/runtimeFinalization.test.js` by evaluating the new browser policy module with a fake window. Add cases:
- CANCELLED → `mode:"skip"`.
- FAILED → `mode:"local"` with empty message so app uses its existing user-facing error fallback.
- artifact-only success → `mode:"local"`.
- one active terminal research/organize/write/convert node with non-empty string `outputs.result` → local with that exact message.
- one terminal node with structured object result → `mode:"model"`.
- two independent successful terminal branches → `mode:"model"`.
- judge/ambiguous terminal result → `mode:"model"`.

- [ ] **Step 2: Add bootstrap/precache architecture assertions**

Extend `test/uiArchitecture.test.js` to assert `runtimeFinalization.js` is loaded before `app.js` in `front/js/boot.js` and included in `front/sw.js` shell precache.

- [ ] **Step 3: Run finalization/UI tests and verify failure**

Run: `node --test test/runtimeFinalization.test.js test/uiArchitecture.test.js`

Expected: FAIL because the module is not present/wired.

- [ ] **Step 4: Implement the pure decision module**

In `front/js/runtimeFinalization.js`:
- inspect `run.status`, `run.nodes`, and `run.workflow.connections`
- identify active successful terminal nodes based on actual successful downstream states
- apply artifact/failure/cancellation rules before terminal-text bypass
- never stringify structured output into a user message

Keep DOM, API calls, Presence, and chat rendering out of this module.

- [ ] **Step 5: Apply the decision in `finalizeRuntimeRun()`**

In `front/js/app.js`:
- `skip`: settle runtime UI without calling `API.finalizeRun()` or adding a final assistant message
- `local`: use decision message when supplied, otherwise `fallbackRuntimeMessage(run)`
- `model`: keep the existing `API.finalizeRun()` call and local fallback on failure

Preserve artifact attachment to the resulting chat message and existing Presence/reveal behavior.

- [ ] **Step 6: Wire the new browser module and rotate shell cache**

Add `./js/runtimeFinalization.js` before `./js/app.js` in `front/js/boot.js`.

Add `/js/runtimeFinalization.js` to `front/sw.js` `SHELL` and rotate `ovll-shell-v44` to `ovll-shell-v45`.

- [ ] **Step 7: Run finalization/UI tests**

Run: `node --test test/runtimeFinalization.test.js test/uiArchitecture.test.js`

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add front/js/runtimeFinalization.js front/js/app.js front/js/boot.js front/sw.js test/runtimeFinalization.test.js test/uiArchitecture.test.js
git commit -m "fix: avoid unnecessary Gemini finalization"
```

### Task 6: Full regression verification and deployment version bump

**Files:**
- Modify: `server.js`
- Verify: all files changed by Tasks 1-5

**Interfaces:**
- No new runtime interface; this task proves the integrated behavior and updates deployment identity.

- [ ] **Step 1: Run the complete automated suite before the version bump**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 2: Inspect the final code paths against the spec**

Verify manually in source:
- `executeGroup()` outbound body is produced only by `buildExecutionPayload()`.
- Runtime cache misses are grouped into maximal consecutive segments.
- app runtime execution passes memory into cache context and uses API measurement.
- no 429/network/5xx path can switch to fallback.
- abort signal reaches Gemini fetch and abortable retry wait.
- failed/cancelled/artifact-only runs do not call the model finalizer.
- no server log prints request bodies or generated content.

- [ ] **Step 3: Bump `server.js` APP_VERSION once for the completed rollout**

Increment the current `2026.10.05.65` to the next unused deployment version present at implementation time. Re-read main immediately before editing so concurrent version bumps are not overwritten.

- [ ] **Step 4: Run the complete suite again after the version bump**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit the deployment version bump**

```bash
git add server.js
git commit -m "chore: bump app version for execution quality rollout"
```

- [ ] **Step 6: Final branch review**

Review the complete diff from the pre-implementation base to HEAD for:
- accidental model-tier changes
- duplicated compaction/retry paths
- unbounded retry/fallback loops
- raw-content logging
- missing shell-cache entry/version rotation
- unrelated UI changes
- missing tests from the Review Focus section

Expected: no findings that require code changes before completion.
