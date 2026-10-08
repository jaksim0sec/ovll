# Gemini Grouped Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute safe linear Gemini-capable workflow segments in one Gemini API request while preserving per-node runtime state, branching, failure propagation, and free-tier-oriented defaults.

**Architecture:** RuntimeEngine remains authoritative for graph semantics and plans linear execution groups. A focused server module performs stateless Gemini Interactions API requests with structured JSON output, validation, retry/backoff, and fallback. The browser calls only `/api/execute-group`; API keys and model selection remain server-side.

**Tech Stack:** Browser JavaScript, Node.js ESM, Express 5, Node test runner, Gemini Interactions REST API.

**Spec:** `docs/superpowers/specs/2026-10-04-gemini-group-execution-design.md`

## Global Constraints

- Default model: `gemini-3.5-flash-lite`
- Fallback model: `gemini-3.1-flash-lite`
- Server-only `GEMINI_API_KEY`
- Interactions endpoint: `https://generativelanguage.googleapis.com/v1beta/interactions`
- `store:false`
- Default `thinking_level:"minimal"`
- No hard-coded RPM/RPD quota numbers
- Default max group nodes: 6
- Default max serialized group input: 60000 chars
- Gemini-capable: research, organize, judge, write, convert
- Local boundaries: start, file, createFile
- judge always isolated
- Existing target/spread/failure semantics stay intact
- Every deployed code update bumps `server.js` APP_VERSION

## Review Focus

- Group response has missing, duplicate, extra, or reordered node IDs: reject before committing node results.
- A fork/merge hidden behind data edges: grouping must count both flow and data dependencies.
- Gemini 429 with Retry-After: retry without killing independent workflow branches.
- Group transport/model failure after earlier independent groups succeeded: only the failed dependency chain is blocked.
- Excessive or malformed browser request: reject before any Gemini network call.

---

### Task 1: Runtime group planner and state commit

**Files:**
- Modify: `front/js/runtimeEngine.js`
- Test: `test/runtimeEngine.test.js`

**Interfaces:**
- Consumes: existing normalized workflow, node states, executor.run()
- Produces: optional executor.runGroup(group, context), per-node result commit

- [ ] Add failing tests proving research→organize→write is one group call, fork/merge/judge/local nodes cut groups, and group failure maps to FAILED/SKIPPED while independent branches continue.
- [ ] Run `node --test test/runtimeEngine.test.js` and verify new tests fail for missing grouping.
- [ ] Implement group planning from 1-in/1-out dependency topology using both flow and data edges, max 6 nodes, judge/local boundaries.
- [ ] Commit each returned result to the matching node state in order and preserve node:state/edge events.
- [ ] Run `node --test test/runtimeEngine.test.js` and verify all runtime tests pass.
- [ ] Commit runtime grouping changes.

### Task 2: Browser execution API adapter

**Files:**
- Modify: `front/js/api.js`
- Modify: `front/js/app.js`

**Interfaces:**
- Consumes: `AstraAPI.request(path, options)`
- Produces: `AstraAPI.executeGroup(group, options)` and executor object with `run` + `runGroup`

- [ ] Add `executeGroup(group, options)` posting only group nodes/connections to `/api/execute-group`.
- [ ] In app RuntimeEngine construction, inject an executor that keeps local start/file/createFile execution local and sends Gemini-capable groups through `API.executeGroup`.
- [ ] Preserve existing UI runtime events and no-key-in-browser invariant.
- [ ] Commit browser adapter changes.

### Task 3: Gemini server execution module

**Files:**
- Create: `geminiExecution.js`
- Create: `test/geminiExecution.test.js`

**Interfaces:**
- Produces: `createGeminiExecution(options)` with `executeGroup(nodes)`, pure validation/prompt/schema helpers exported for tests.

- [ ] Write failing tests for default model, server API key header, store:false, structured response_format, minimal thinking, response node-ID validation, 429 Retry-After, fallback, and oversized input rejection.
- [ ] Run `node --test test/geminiExecution.test.js` and verify failures.
- [ ] Implement request validation and compact prompt builder with fixed system instruction plus server-owned per-node instructions.
- [ ] Implement Interactions REST call and parse REST model_output text from interaction steps, with compatibility fallback for any top-level text field returned by the API.
- [ ] Implement structured JSON schema and exact node-result semantic validation.
- [ ] Implement 429/5xx/network retry and fallback model policy, with injectable fetch/sleep for deterministic tests.
- [ ] Run `node --test test/geminiExecution.test.js` and verify pass.
- [ ] Commit Gemini module.

### Task 4: Express endpoint and wiring

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `createGeminiExecution()`
- Produces: `POST /api/execute-group`

- [ ] Import/configure Gemini execution once at server startup.
- [ ] Add `POST /api/execute-group` with JSON validation and safe error shape.
- [ ] Return model, usage totals, and normalized results without raw Gemini payloads.
- [ ] Bump APP_VERSION.
- [ ] Commit server wiring.

### Task 5: Full verification

**Files:**
- Verify all changed files

- [ ] Run `npm test`.
- [ ] Re-read active browser wiring and verify DemoNodeExecutor is no longer the active app execution path.
- [ ] Verify `GEMINI_API_KEY` is only read server-side.
- [ ] Verify current APP_VERSION is bumped.
- [ ] Record any limitation if a live API smoke test cannot run because no key is available.
