# Non-IR Workshop Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Execute all eleven non-IR Workshop behaviors using independently replaceable resource, action, checkpoint and session ports; complete Hallway Return and Output without fake-success paths.

**Architecture:** The engine orchestrates model decisions and deterministic state transitions. Separate in-memory adapters own authoritative Skill/Canvas assets and revisioned request checkpoints. The HTTP/UI transport projects confirmed results; it never decides execution success.

**Tech Stack:** Node.js 22 ESM, built-in node:test, existing Gemini caller and prompt composer.

**Spec:** docs/superpowers/specs/2026-10-23-non-ir-workshop-engine-design.md

## Global Constraints
- Only beta; main stays untouched.
- Keep existing direct Hallway completion behavior and prompt contracts intact.
- All action data validated, with explicit revision and operation idempotency.
- No IR work or execution, no dummy confirmation.
- Session ContextData persists per room; request ContextBlock remains per request.
- Memory implementation is not durable; no DB/auth/actual persisted user migration claims.

## Review Focus
- Repeated operation ID, including an uncertain response -> no duplicate side effect (Task 1).
- Stale revision and reference violation -> atomic rejection (Task 1 and 2).
- Question resumed twice, from wrong room, or without user input -> safe rejection (Task 3).
- Output failure after committed actions -> preserve asset, no reapply (Task 3).
- Failure/replanning exhaustion -> stop with visible truthful error (Task 3).

---

### Task 1: Revisioned Memory Asset / Checkpoint Ports

**Files:**
- Create: back/js/engine/memoryAssets.js, back/js/engine/checkpoints.js
- Test: tests/backend/workshop-assets.test.mjs

**Interfaces:**
- createMemoryAssets({createId?}).read({scope}), .apply({scope,requestId,operationId,action,args,expectedRevision}), .getOperation({scope,operationId})
- createMemoryCheckpoints().load({scope,requestId}), .save({scope,requestId,expectedRevision,next})
- Single scope is the Beta room, owned by server; future adapters implement same calls.

- [ ] Write tests covering all 9 Skill/Canvas actions, revisions, nonexistent references, duplicate operation, circular connections, and Skill schema compatibility.
- [ ] Verify tests fail before creating implementations.
- [ ] Implement atomic cloned-and-validate state changes, per-room monotonic revision and operation memoization; checkpoint CAS.
- [ ] Run focused tests, then existing backend suite.
- [ ] Commit.

### Task 2: Workshop action selection, prompt contracts and execution

**Files:**
- Create: back/js/engine/workshop.js
- Modify: prompts/manifest.json
- Create: prompts/base/workshop.md and prompts/blocks/workshopActions.md
- Test: tests/backend/workshop-engine.test.mjs

**Interfaces:**
- createWorkshopExecutor({modelCaller,composer,assets}) .execute({workshop,objective,request,contextBlock,resources,roomId,requestId,operationId,budget,verifiedResults})
- Validated model JSON choices: {action, args} | {done:true}. Only named actions from each Workshop. IR attempts fail as UNSUPPORTED_ACTION.
- Deterministic, server-validated apply and typed results; not model assertion.

- [ ] Write RED tests for supported/unsupported actions and target validation.
- [ ] Implement model-neutral action selection and prompt layer with only that Workshop's actions.
- [ ] Verify focus + test suite.
- [ ] Commit.

### Task 3: Orchestrated lifecycle, waiting/resume, Hallway Return and Output

**Files:**
- Modify: back/js/engine/engine.js, back/js/request/registry.js, back/js/request/scheduler.js
- Test: tests/backend/workshop-lifecycle.test.mjs

**Interfaces:**
- engine.run(snapshot,{onStage,checkpoint?}) returns {status, currentLayer, result?, contextData?, contextBlock?, waiting?, records?, changes?}
- engine.resume(snapshot,{answer,onStage}) continues checkpoint without replaying side effects.
- question returns awaiting_input, scheduler.release and resume through same requestId; state revision verifies ownership.
- onStage(stage) records stage and request execution events.

- [ ] Write tests for multi-action full cycle, partial plan Hallway Return, Output, waiting/resume, repeated answer, budget, Output failure/no duplicate effects.
- [ ] Verify RED then implement smallest scheduler/registry/engine continuation.
- [ ] Run focused + existing suite.
- [ ] Commit.

### Task 4: Beta HTTP/Chat projection and resource wiring

**Files:**
- Modify: back/js/server.js, back/js/httpServer.js, front/js/workspace/requestBridge.js, front/js/workspace/controller.js, front/js/boot.js
- Test: tests/backend/render-bridge.test.mjs and new tests/backend/workshop-http.test.mjs

**Interfaces:**
- GET /api/rooms/:id/assets reads confirmed versioned memory; POST /api/requests/:id/answer with {roomId,waitingId,text} resumes request.
- POST requests and GET request preserve current paths. Request snapshots show confirmed outputs and waiting states.
- Canvas frontend commands/presentation only reflect confirmed server state; reconcile or explicitly flag conflicts.

- [ ] Write RED HTTP tests for confirmed assets, waiting/resume/incorrect room, and UI visible result.
- [ ] Implement thin service adapters, safe public response and beta UI projection.
- [ ] Verify focused + complete project tests.
- [ ] Commit.

### Task 5: Final verification and implementation documentation

**Files:**
- Update: docs/developing/workshops.md, docs/developing/request-engine.md, docs/developing/architecture.md, docs/developing/context.md, AGENTS.md

- [ ] Run npm test, ensure all existing direct response and new IR exclusion tests pass.
- [ ] Validate command syntax, test asset read-after-write and repeated operation through HTTP.
- [ ] Sync docs only with verified implementation, explicitly noting volatile runtime and unverified external Gemini/Render.
- [ ] Review diff and commit.
