# Native Function Calling and Verified Workshop Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Carry a real "create plant research Skill Block" plan through Gemini Function Calling, validated server Skill creation, Block placement and Output, without resurrecting the retired Workshop.

**Architecture:** A descriptor owns each named action's prompt and tool schema. Gemini proposes input, the server Action Port validates/applies, the Engine tracks verified outcomes and moves the cursor. Managed multi-request concurrency and frontend conflict protection remain in place.

**Tech Stack:** Node 22 ESM, existing generateContent REST adapter, node:test, in-memory beta assets and the current browser projection. No new package dependencies.

**Spec:** docs/superpowers/specs/2026-10-24-native-workshop-function-calling-design.md

## Constraints and review focus

- beta only; main unchanged.
- Implement first two actions only: skillDefine.defineDirect, canvasEdit.addBlock. Other action names must stay explicitly unsupported, IR included.
- One tool declaration per selected action; function call is a proposal, not a successful mutation.
- Immutable request vs call vs operation identity. No invented server IDs or snapshots.
- Explicit request checkpoint before apply; idempotent operationId and revision checks; partial outcomes survive Output failure.
- Preserve browser provisional graph when server projection conflicts.
- Preserve direct Hallway reply and in-memory multi-request concurrency.
- Security tests: mismatched tool, malformed schema, cross-room Skill ID, stale revision, duplicate op, cancellation race and secret leakage.

## Task 1: Gemini Function Calling provider

**Files:** modify back/js/model/gemini.js and configuredGemini.js; create tests/backend/gemini-function-calling.test.mjs.

**Interface:** generateFunction({prompt,context,tool,signal}) -> {kind:'function_proposal',name,args}.

- [ ] Step 1: write failing test asserting exactly one functionDeclaration and functionCallingConfig ANY with allowedFunctionNames, no responseMimeType JSON. Reject wrong-name/multiple/zero tool calls, nonobject args and failures.
- [ ] Step 2: run node --test tests/backend/gemini-function-calling.test.mjs; expected RED (API absent).
- [ ] Step 3: implement REST adapter function mode without changing generate JSON mode.
- [ ] Step 4: run targeted test and npm test; expected GREEN.
- [ ] Step 5: commit feat(beta): add constrained Gemini native Function Calling port.

## Task 2: Selected-action descriptors and prompts

**Files:** create back/js/engine/actionDescriptors.js, prompts/base/skillDefine.md, base/canvasEdit.md, blocks/defineDirect.md, blocks/addBlock.md; update prompts/manifest.json; create tests/backend/action-descriptors.test.mjs.

**Interface:** getActionDescriptor(action) -> {action,promptLayer,tool,validateArgs} | null, only for the two implemented actions.

- [ ] Step 1: tests for supported descriptors, exact tool schema, real icon/port/field validation, unknown actions rejected and unrelated prompts excluded.
- [ ] Step 2: run node --test tests/backend/action-descriptors.test.mjs; expected RED.
- [ ] Step 3: implement validators and selective prompts using current frontend contract.
- [ ] Step 4: run targeted + npm test; expected GREEN.
- [ ] Step 5: commit feat(beta): select two validated Workshop action contracts.

## Task 3: Server authoritative in-memory asset port

**Files:** create back/js/assets/memoryActionStore.js, tests/backend/action-assets.test.mjs.

**Interface:** read({scope}), apply({scope,requestId,operationId,action,args,expectedRevision}), getOperation({scope,operationId}).

- [ ] Step 1: tests for Skill definition then Block with real Skill ID, revision increments, request/room isolation, idempotency, incompatible duplicate ID, stale revision and invalid icon/field/Skill rejection.
- [ ] Step 2: run targeted; expected RED.
- [ ] Step 3: implement atomic synchronous memory store, frontend-compatible Skill/Block shape, operation receipt; do not touch local Canvas.
- [ ] Step 4: run targeted + npm test; expected GREEN.
- [ ] Step 5: commit feat(beta): validate and apply room-scoped Skill and Block actions.

## Task 4: Identified Workshop Function Calls

**Files:** modify back/js/engine/callManager.js; extend tests/backend/call-manager.test.mjs.

**Interface:** invokeFunction({roomId,requestId,requestRevision,route,context,tool,bindings,signal}) -> {callId,proposal}.

- [ ] Step 1: failing tests for workshop.callId route, single supplied tool, temporary focus, provider timeout/error/cancellation and shared model call slots.
- [ ] Step 2: run targeted; expected RED.
- [ ] Step 3: implement using existing CallRegistry and model concurrency semaphore.
- [ ] Step 4: run targeted + npm test; expected GREEN.
- [ ] Step 5: commit feat(beta): register and limit Workshop Function Calls.

## Task 5: Verified plan advancement and Output

**Files:** modify back/js/engine/requestRunner.js, engine.js, request/registry.js, request/scheduler.js; create tests/backend/verified-workflow.test.mjs and extend action-routing.test.mjs.

**Interface:** requestRunner.run(snapshot,{onStage,onCheckpoint,signal}) resolves sequential approved actions and terminate; onCheckpoint saves pendingOperation, verifiedResults and planCursor before/after each mutation.

- [ ] Step 1: fake Gemini tests for plan defineDirect -> addBlock -> terminate -> Output, proper prior actual Skill ID, all calls separately identified, invalid proposal rejection, unsupported later action with partial receipts, Output failure preserving completed assets, canceled-before-apply.
- [ ] Step 2: run targeted; expected RED.
- [ ] Step 3: implement Engine-owned cursor/checkpoints and old direct-response compatibility; do not execute arbitrary tools, do not infer success from functionCall.
- [ ] Step 4: run targeted + npm test; expected GREEN.
- [ ] Step 5: commit feat(beta): execute two-step verified action plans.

## Task 6: Production composition, safe frontend assets and regression

**Files:** modify back/js/server.js; optionally front/js/workspace/requestBridge.js only for a verified projection mismatch; update AGENTS.md and related docs/developing/*.md; extend tests/backend/call-http.test.mjs and frontend projection contract tests as needed.

- [ ] Step 1: failing end-to-end fake-provider HTTP test: assets listing includes newly applied Skill+Block, response includes real receipts, direct reply unchanged; local Canvas provisional conflicts preserved.
- [ ] Step 2: run targeted; expected RED.
- [ ] Step 3: pass one Action Store instance to data provider, Engine and HTTP; preserve existing frontend guarded server projection. Update docs to the tested behavior.
- [ ] Step 4: run npm test and npm run test:frontend:unit, expected GREEN; browser Playwright and real Gemini/Render are separate checks.
- [ ] Step 5: commit and perform final code review; report unsupported actions and memory-only limitation.

## Explicitly deferred

No production user auth, no DB persistence or distributed operation transaction, no automatic synchronization of unrelated local graphs, no autonomous Skill research execution, no IR and no Function Calling tool/result continuation needed for this one-tool-per-call architecture. Function signatures for other actions, Hallway Return general replanning and textGenerate.question are separate specs.
