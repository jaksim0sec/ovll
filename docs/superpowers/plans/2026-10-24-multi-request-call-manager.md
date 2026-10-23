# Ovll Multi-Request Engine & Call Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change Beta from a server-assembled single-request runner to a **managed multi-request Engine**, tracking each Gate/Hallway/Action Shell call using an ID and route such as `adffyhd36yt6.workshop.skillDefine.defineDirect`.

**Architecture:** The Engine owns request/call states, queue policy, transitions, and request-local context. An internal RequestRunner performs one request's Gate/Hallway logic. Every model invocation is registered with a Call Manager, which prepares an ephemeral frame and delegates provider transport to a model adapter. This first phase stops at **the inert Action Shell** and never executes Skill/Canvas mutations.

**Tech Stack:** Node 22–24 ESM JavaScript, built-in `node:test`, current Gemini REST JSON caller, memory adapters and HTTP. No new runtime dependencies for this phase.

**Spec:** `docs/superpowers/specs/2026-10-24-action-workshop-routing-design.md`

## Global Constraints

- Modify **beta only**; no `main` changes, merges or deployment. Read `AGENTS.md` first.
- Gate/Hallway direct replies remain functional. Hallway action plans select qualified names; the first planned action reaches `Action Shell` and returns `status:unsupported_workshop` / `handoff.status:not_implemented`. Do not execute subsequent actions, `terminate`, Hallway Return or Output for work plans in this phase.
- `requestId` identifies one entire request; `callId` one invocation; `operationId` one future side effect. Never use a Gemini provider call ID as any of these.
- `<callId>.<route>` is a derived display path; store callId and structured route separately. Only the Engine can select route or advance plan cursor.
- `contextBlock.intent/progress` belongs to the request, `contextData` to the room, and `focus` to a temporary call. Do not persist full prompts or provider trace/secrets in public RequestRecord/CallRecord.
- Engine is a **concurrent request manager**, not merely `run(snapshot)`. Request worker pool and model-call pool have independent budgets. Suggested configurable defaults: `maxActiveRequests=3`, `maxModelCalls=2` (unmeasured, adjustable).
- Data mutations must be based on verified results; this phase has no mutating actions. No resurrection of deleted beta `workshop.js`/memoryAssets/checkpoints or IR behavior.
- Same-room session updates require revision/CAS. A failed, canceled, waiting or unsupported action is not a successful Skill/Canvas change.
- Follow TDD: write targeted failing test; run red; implement; run green including impacted regressions; commit each self-contained task. Update `docs/developing/` and `AGENTS.md` only to match confirmed implementation.
- Where this plan labels an action future/Stage 2, do not silently implement it.

## Review Focus

The five most dangerous implied cases, pinned to owner tasks:
1. Two requests in **same room** both write `contextData`: one wins, other receives `SESSION_CONFLICT`, neither silently overwrites (Task 5).
2. Provider returns **after cancellation**: old response cannot modify state, cursor or confirmed result (Task 7).
3. **Forged/ambiguous call path**, or cross-room call read: rejected without exposing another request's call data (Task 2; Task 8).
4. **Two independent pools**: three active requests can coexist with only two Gemini calls; errors release slots (Task 4).
5. An **inert action** has a callId but no applied asset, no verified result and no plan advancement (Task 6).

## File responsibility map

| Path | Ownership |
|---|---|
| `back/js/engine/engine.js` | Managed `createEngine` facade, shared components, request/call public control |
| `back/js/engine/requestRunner.js` (new) | Existing Gate/Hallway per-request logic moved out of Engine facade |
| `back/js/request/registry.js` | RequestRecord state, revision/CAS |
| `back/js/request/callRegistry.js` (new) | CallRecord IDs, structured routes and safe reads |
| `back/js/request/scheduler.js` | Engine-owned request queue, running slots, waiting/requeue/cancel |
| `back/js/request/memorySessions.js` | Room-scoped context revision and history, CAS commits |
| `back/js/engine/callManager.js` (new) | Call creation, per-call frame/focus, model slots, normalized results |
| `back/js/engine/actionShell.js` | Inert action validation and handoff, **not** execution |
| `back/js/engine/promptComposer.js` | Manifest-based prompt assembly as today; call site moves to Call Manager |
| `back/js/model/{gemini,configuredGemini}.js` | Existing provider-only JSON adapter; no Function Calling feature yet |
| `back/js/server.js`, `back/js/demo.js` | Construct the managed Engine once |
| `back/js/httpServer.js`, `front/js/workspace/requestBridge.js` | Public status/call snapshots and UI projection |
| `tests/backend/*.test.mjs` | Deterministic tests and existing regressions |

### Task ownership and boundaries

- Task 1 changes the **public Engine identity** without changing existing Gate/Hallway behavior.
- Tasks 2–3 add independent call identity and temporary execution state.
- Tasks 4–5 make concurrency and state commits actually safe.
- Task 6 connects the **current Action Shell**, not a speculative executor.
- Tasks 7–8 manage cancellation and safe public observability.
- Task 9 verifies integration and updates only actual-implementation documentation.

---
### Task 1: Expose a managed multi-request Engine, not only run(snapshot)

**Files:** Create `back/js/engine/requestRunner.js`, `tests/backend/managed-engine.test.mjs`; modify `back/js/engine/engine.js`, `back/js/server.js`, `back/js/demo.js`; adjust import sites in existing `engine.test.mjs` and `action-shell.test.mjs` only as necessary.

**Interfaces:** `createRequestRunner({composer,modelCaller,dataProvider,actionShell}).run(snapshot,{onStage,signal?})` retains current per-request Gate/Hallway behavior. `createEngine({composer,modelCaller,dataProvider,actionShell?,registry?,sessions?,policy?})` constructs ONE registry, scheduler and runner and initially exposes `submit({roomId,request,initialResources=[]})->{roomId,requestId,completion}`, `getRequest({roomId,requestId})`, `whenIdle()`. Keep `createRequestEngine` as a thin compatibility alias only if existing tests need it; never maintain two runner bodies.

- [ ] **Step 1: Write the failing test** in the named test file(s). Assert at least:

```js
const e=createEngine({composer,modelCaller,dataProvider:createMemoryDataProvider()});
const a=e.submit(sample('room-a')),b=e.submit(sample('room-b'));
assert.notEqual(a.requestId,b.requestId);
assert.equal((await a.completion).status,'completed');
assert.equal((await b.completion).status,'completed');
assert.equal(e.getRequest({roomId:'room-b',requestId:a.requestId}),null);
```

- [ ] **Step 2: Verify RED** — Run `node --test tests/backend/managed-engine.test.mjs`. Expected: FAIL for the unimplemented behavior, not a test syntax/fixture error.
- [ ] **Step 3: Implement the minimum** — Extract current `createRequestEngine` logic into `requestRunner.js`, create the facade in `engine.js`, and update actual server/demo wiring. No change to action-execution boundary or public HTTP payload.
- [ ] **Step 4: Verify GREEN** — Run `node --test tests/backend/managed-engine.test.mjs tests/backend/engine.test.mjs tests/backend/assessment-milestone.test.mjs && npm test`. Expected: all targeted tests PASS.
- [ ] **Step 5: Commit** — Stage only Task 1 code/tests and commit `refactor(beta): introduce managed multi-request engine facade`.

### Task 2: Define per-call ID, qualified route and immutable CallRecord

**Files:** Create `back/js/request/callRegistry.js`, `tests/backend/call-registry.test.mjs`; modify `back/js/request/registry.js` only for request/call ownership tracking.

**Interfaces:** `createCallRegistry({createId=()=>crypto.randomUUID()})`: `register({roomId,requestId,route,requestRevision})->CallRecord`, `get({roomId,requestId,callId})->CallRecord|null`, `list({roomId,requestId})->CallRecord[]`, `finish({roomId,requestId,callId,status,expectedRevision,outcomeRef?})->CallRecord`. Route union: `{layer:'gate'}`, `{layer:'hallway',phase:'initial'|'return'}`, `{layer:'workshop',workshop,action}`, `{layer:'output'}`. Validate the workshop/action pair using current `actionCatalog`. Call statuses `queued|running|completed|failed|cancelled|unsupported`. `path=callId+'.'+routeSegments.join('.')` is derived, never a primary key.

- [ ] **Step 1: Write the failing test** in the named test file(s). Assert at least:

```js
const c=createCallRegistry({createId:(()=>{let n=0;return ()=>'c'+(++n)})()});
const first=c.register({roomId:'r',requestId:'req',requestRevision:0,
  route:{layer:'workshop',workshop:'skillDefine',action:'defineDirect'}});
assert.equal(first.path,'c1.workshop.skillDefine.defineDirect');
assert.equal(c.get({roomId:'r2',requestId:'req',callId:'c1'}),null);
assert.throws(()=>c.register({roomId:'r',requestId:'req',requestRevision:0,
  route:{layer:'workshop',workshop:'skillDefine',action:'unknown'}}));
```

- [ ] **Step 2: Verify RED** — Run `node --test tests/backend/call-registry.test.mjs`. Expected: FAIL for the unimplemented behavior, not a test syntax/fixture error.
- [ ] **Step 3: Implement the minimum** — Implement scoped immutable CallRegistry with ID uniqueness, no dots inside IDs, strict route validation and single terminal transition per Call. Also test forged paths, repeated finish, returned-object mutation and cross-request access.
- [ ] **Step 4: Verify GREEN** — Run `node --test tests/backend/call-registry.test.mjs`. Expected: all targeted tests PASS.
- [ ] **Step 5: Commit** — Stage only Task 2 code/tests and commit `feat(beta): register calls by unique ID and structured route`.

### Task 3: Build CallManager and ephemeral context projection

**Files:** Create `back/js/engine/callManager.js`, `tests/backend/call-manager.test.mjs`; modify `back/js/engine/requestRunner.js`, `back/js/engine/engine.js`.

**Interfaces:** `createCallManager({callRegistry,composer,modelCaller,maxModelCalls=2})` exports `invoke({roomId,requestId,requestRevision,route,context,bindings={},format:'json',signal?})->{callId,jsonText}` plus `enterAction(...)` in Task 6. `invoke` registers Call before provider call, composes only the selected prompt, derives a *new* `focus` based on route/objective/confirmed results, gives the provider an immutable `context` snapshot, then finalizes Call status. CallFrame lives only during invoke and is not persisted.

- [ ] **Step 1: Write the failing test** in the named test file(s). Assert at least:

```js
await manager.invoke({roomId:'r',requestId:'req',requestRevision:0,
  route:{layer:'gate'},context:{userRequest:'hi'}});
await manager.invoke({roomId:'r',requestId:'req',requestRevision:0,
  route:{layer:'hallway',phase:'initial'},
  context:{contextBlock:{intent:'reply',progress:''},userRequest:'hi'}});
const log=registry.list({roomId:'r',requestId:'req'});
assert.equal(log.length,2);
assert.notEqual(log[0].callId,log[1].callId);
assert.equal(log[0].path.endsWith('.gate'),true);
assert.equal('focus' in (storedRequest.contextBlock??{}),false);
```

- [ ] **Step 2: Verify RED** — Run `node --test tests/backend/call-manager.test.mjs`. Expected: FAIL for the unimplemented behavior, not a test syntax/fixture error.
- [ ] **Step 3: Implement the minimum** — Route Gate and Hallway invocations in RequestRunner through CallManager. Verify per-call focus differs and no raw prompt, secret, provider response or `focus` enters CallRecord or persistent RequestRecord. Model transport errors finalize only their call.
- [ ] **Step 4: Verify GREEN** — Run `node --test tests/backend/call-manager.test.mjs tests/backend/engine.test.mjs tests/backend/gemini-caller.test.mjs`. Expected: all targeted tests PASS.
- [ ] **Step 5: Commit** — Stage only Task 3 code/tests and commit `feat(beta): centralize provider calls and ephemeral call frames`.

### Task 4: Allow multiple requests and separately bound model-call slots

**Files:** Modify `back/js/request/scheduler.js`, `back/js/engine/callManager.js`, `back/js/engine/engine.js`; create `tests/backend/concurrent-engine.test.mjs`; extend `tests/backend/request-lifecycle.test.mjs`.

**Interfaces:** `createEngine({...,policy:{maxActiveRequests:3,maxModelCalls:2}})` validates positive integers; wires Scheduler `maxConcurrent=maxActiveRequests` and CallManager provider limiter `maxModelCalls`. A model slot is acquired immediately before `modelCaller.generate` and always released on success, error and cancellation; a request slot is released when its request finishes or waits for external input.

- [ ] **Step 1: Write the failing test** in the named test file(s). Assert at least:

```js
// Use deferred promises, not sleeps:
const a=engine.submit(sample('a')),b=engine.submit(sample('b'));
const c=engine.submit(sample('c')),d=engine.submit(sample('d'));
await allThreeRequestEntrances;
assert.equal(activeRequests,3);   // d remains queued
assert.equal(maxObservedProviderCalls,2);
releaseOneProviderCall();
await nextProviderEntry;
assert.equal(maxObservedProviderCalls,2);
```

- [ ] **Step 2: Verify RED** — Run `node --test tests/backend/concurrent-engine.test.mjs`. Expected: FAIL for the unimplemented behavior, not a test syntax/fixture error.
- [ ] **Step 3: Implement the minimum** — Provide independent FIFO request and provider capacity pools. Ensure thrown model calls unblock provider waiters; awaiting_input releases request slots. Do not confuse JS concurrent promises with CPU-parallel execution.
- [ ] **Step 4: Verify GREEN** — Run `node --test tests/backend/concurrent-engine.test.mjs tests/backend/request-lifecycle.test.mjs tests/backend/workshop-scheduler.test.mjs`. Expected: all targeted tests PASS.
- [ ] **Step 5: Commit** — Stage only Task 4 code/tests and commit `feat(beta): support concurrent requests and bounded Gemini calls`.

### Task 5: Add revision/CAS and protect concurrent same-room writes

**Files:** Modify `back/js/request/registry.js`, `back/js/request/memorySessions.js`, `back/js/request/scheduler.js`; extend `tests/backend/concurrent-engine.test.mjs`, `tests/backend/workshop-sessions.test.mjs`, `tests/backend/assessment-milestone.test.mjs`.

**Interfaces:** RequestRegistry adds `revision:number`, supports `transition(roomId,requestId,changes,{expectedRevision?})`, and returns `CHECKPOINT_CONFLICT` on stale writes. Engine-internal transitions always use expectedRevision. Session `commit({scope,expectedRevision,...})` retains committed/conflict status; if necessary separate `contextRevision` from `historyRevision` so recording a failure does not look like a context change. Never mark request completed before session commit succeeds.

- [ ] **Step 1: Write the failing test** in the named test file(s). Assert at least:

```js
const a=engine.submit(sample('same')), b=engine.submit(sample('same'));
await bothLoadedSameSessionRevision;
release(a); release(b);
const [r1,r2]=await Promise.all([a.completion,b.completion]);
assert.deepEqual([r1.status,r2.status].sort(),['completed','failed']);
assert.equal([r1,r2].find(r=>r.status==='failed').error.code,'SESSION_CONFLICT');
assert.equal(sessions.load({scope:'same'}).contextData.overallFlow,'winner');
```

- [ ] **Step 2: Verify RED** — Run `node --test tests/backend/concurrent-engine.test.mjs tests/backend/workshop-sessions.test.mjs`. Expected: FAIL for the unimplemented behavior, not a test syntax/fixture error.
- [ ] **Step 3: Implement the minimum** — Implement Request CAS and session commit ordering; stale Call result cannot move request state if `requestRevisionAtStart` or active call ownership has changed. Keep recent history max eight and failures separate from confirmed room context.
- [ ] **Step 4: Verify GREEN** — Run `node --test tests/backend/concurrent-engine.test.mjs tests/backend/workshop-sessions.test.mjs tests/backend/assessment-milestone.test.mjs`. Expected: all targeted tests PASS.
- [ ] **Step 5: Commit** — Stage only Task 5 code/tests and commit `fix(beta): prevent stale call and room context commits`.

### Task 6: Give the first named Action Shell its own Call ID without executing it

**Files:** Modify `back/js/engine/requestRunner.js`, `back/js/engine/callManager.js`, `back/js/engine/actionShell.js`, `back/js/engine/engine.js`; extend `tests/backend/action-shell.test.mjs`, `tests/backend/call-manager.test.mjs`.

**Interfaces:** `callManager.enterAction({roomId,requestId,requestRevision,action,objective,need,resources})->{callId,handoff}` registers route `{layer:'workshop',workshop:'skillDefine',action:'defineDirect'}` for selected `skillDefine.defineDirect`, invokes **only** `actionShell.enter(...)`, then finalizes Call `unsupported`. Handoff preserves original fields and adds `callId`; Request retains plan and `planCursor:0`. Add public `engine.listCalls({roomId,requestId})`, `engine.getCall({roomId,requestId,callId})`.

- [ ] **Step 1: Write the failing test** in the named test file(s). Assert at least:

```js
assert.equal(result.handoff.action,'skillDefine.defineDirect');
assert.match(result.handoff.callId,/^[A-Za-z0-9_-]+$/);
const calls=engine.listCalls({roomId:'r',requestId:result.requestId});
assert.equal(calls.at(-1).path,result.handoff.callId+'.workshop.skillDefine.defineDirect');
assert.equal(result.planCursor,0);
assert.deepEqual(result.verifiedResults??[],[]);
```

- [ ] **Step 2: Verify RED** — Run `node --test tests/backend/action-shell.test.mjs`. Expected: FAIL for the unimplemented behavior, not a test syntax/fixture error.
- [ ] **Step 3: Implement the minimum** — Route only the first action to the inert shell. Do not call Gemini again for the shell, do not advance cursor or invent verified Skill/Block changes, and keep `unsupported_workshop` HTTP status compatible.
- [ ] **Step 4: Verify GREEN** — Run `node --test tests/backend/action-shell.test.mjs tests/backend/call-manager.test.mjs tests/backend/managed-engine.test.mjs`. Expected: all targeted tests PASS.
- [ ] **Step 5: Commit** — Stage only Task 6 code/tests and commit `feat(beta): surface action-shell calls without mutation`.

### Task 7: Introduce cancel and guarded resume without stale completion

**Files:** Modify `back/js/request/scheduler.js`, `back/js/request/registry.js`, `back/js/engine/engine.js`, `back/js/engine/callManager.js`; extend `tests/backend/concurrent-engine.test.mjs`, `tests/backend/workshop-scheduler.test.mjs`.

**Interfaces:** `engine.cancel({roomId,requestId})->RequestRecord` marks `stopping`, aborts provider calls when possible, prevents new Call creation, and settles `stopped`. `engine.resume({roomId,requestId,waitingId,answer})->{requestId,completion}` resumes only a genuine `awaiting_input` request and accepts each waitingId once. No production `textGenerate.question` action execution is introduced. Provider abort is advisory: late replies must be discarded by request revision and active call ID checks.

- [ ] **Step 1: Write the failing test** in the named test file(s). Assert at least:

```js
const job=engine.submit(sample('r'));
await startedModelCall; await engine.cancel({roomId:'r',requestId:job.requestId});
resolveModelLate();
assert.equal(engine.getRequest({roomId:'r',requestId:job.requestId}).status,'stopped');
assert.equal(engine.getRequest({roomId:'r',requestId:job.requestId}).verifiedResults?.length??0,0);
```

- [ ] **Step 2: Verify RED** — Run `node --test tests/backend/concurrent-engine.test.mjs tests/backend/workshop-scheduler.test.mjs`. Expected: FAIL for the unimplemented behavior, not a test syntax/fixture error.
- [ ] **Step 3: Implement the minimum** — Handle queued/running cancellation, release both capacity pools, guard stale replies, preserve request IDs through resumption and reject duplicate answer IDs. Avoid hanging promises when waiting on a canceled provider slot.
- [ ] **Step 4: Verify GREEN** — Run `node --test tests/backend/concurrent-engine.test.mjs tests/backend/workshop-scheduler.test.mjs tests/backend/call-manager.test.mjs`. Expected: all targeted tests PASS.
- [ ] **Step 5: Commit** — Stage only Task 7 code/tests and commit `feat(beta): cancel and resume requests safely`.

### Task 8: Expose safe scoped Call history through existing HTTP and UI

**Files:** Modify `back/js/httpServer.js`, `back/js/server.js`, `front/js/workspace/requestBridge.js`; extend `tests/backend/render-bridge.test.mjs`, `tests/backend/assessment-ui.test.mjs`, `tests/backend/action-shell.test.mjs`.

**Interfaces:** Add `GET /api/requests/:requestId/calls?roomId=...`, returning `{roomId,requestId,calls:[{callId,path,route,status,startedAt?,finishedAt?}]}` with existing bearer token/room validation and bounded response length. Existing `GET /api/requests/:requestId?roomId=...` may add `handoff.callId`, `planCursor` and a safe `activeCallId` but no raw prompt/provider trace/secret/args. Production server passes one managed Engine; `httpServer.js` does not construct its own scheduler.

- [ ] **Step 1: Write the failing test** in the named test file(s). Assert at least:

```js
const calls=await fetch(url+'/api/requests/'+id+'/calls?roomId=r',{headers}).then(x=>x.json());
assert.equal(calls.calls.length,3); // Gate, Hallway, shell
assert.equal(calls.calls.at(-1).route.layer,'workshop');
assert.ok(!JSON.stringify(calls).includes('systemPrompt'));
assert.equal((await fetch(url+'/api/requests/'+id+'/calls?roomId=other',{headers})).status,404);
```

- [ ] **Step 2: Verify RED** — Run `node --test tests/backend/render-bridge.test.mjs tests/backend/assessment-ui.test.mjs`. Expected: FAIL for the unimplemented behavior, not a test syntax/fixture error.
- [ ] **Step 3: Implement the minimum** — Expose only filtered call metadata with cross-room ownership check. UI can show call ID/path as progress but must still say `행동 실행 미구현`; do not fabricate confirmed chat receipts.
- [ ] **Step 4: Verify GREEN** — Run `node --test tests/backend/render-bridge.test.mjs tests/backend/assessment-ui.test.mjs tests/backend/action-shell.test.mjs tests/backend/confirmed-history.test.mjs`. Expected: all targeted tests PASS.
- [ ] **Step 5: Commit** — Stage only Task 8 code/tests and commit `feat(beta): expose scoped call progress and routes`.

### Task 9: Run full regression; document the current boundary and Stage-2 handoff

**Files:** Modify `AGENTS.md`, `docs/developing/architecture.md`, `docs/developing/request-engine.md`, `docs/developing/context.md`, `docs/developing/workshops.md`, `docs/developing/render-test-bridge.md`; extend `tests/backend/managed-engine.test.mjs`.

**Interfaces:** Document Engine facade vs per-request Runner, RequestRecord/CallRecord/ephemeral CallFrame, concurrent request/model budgets, abort/CAS semantics, and retained inert shell boundary. **Out of scope:** Gemini native Function Calling, provider thought-signature continuity, action tool declarations, `operationId` persistence, real Skill/Canvas mutation, verified plan cursor progression, Hallway Return and Output on planned actions. Those require a distinct Stage-2 plan with tool schemas and postconditions.

- [ ] **Step 1: Write the failing test** in the named test file(s). Assert at least:

```js
// Full integration: A direct reply, B shell handoff, C model error share one Engine.
const results=await Promise.all([jobA.completion,jobB.completion,jobC.completion]);
assert.deepEqual(results.map(x=>x.status).sort(),['completed','failed','unsupported_workshop']);
assert.equal(results.find(x=>x.status==='unsupported_workshop').verifiedResults?.length??0,0);
assert.equal(engine.listCalls({roomId:'room-b',requestId:jobB.requestId}).at(-1).route.layer,'workshop');
```

- [ ] **Step 2: Verify RED** — Run `node --test tests/backend/managed-engine.test.mjs`. Expected: FAIL for the unimplemented behavior, not a test syntax/fixture error.
- [ ] **Step 3: Implement the minimum** — Resolve any failing integration contracts, run the full backend and supported frontend suites, and update docs only after actual behavior is verified. CI verification is distinct from a real Gemini/Render/mobile run; report all three separately.
- [ ] **Step 4: Verify GREEN** — Run `npm test && node --test tests/frontend/*.test.mjs`. Expected: all targeted tests PASS.
- [ ] **Step 5: Commit** — Stage only Task 9 code/tests and commit `docs(beta): record managed engine and call routing limits`.
## Spec coverage / deliberate deferrals

| Spec requirements | Owning tasks |
|---|---|
| Engine controls many requests, queue and isolated RequestRunner | 1, 4 |
| Per-invocation ID/route and stable request association | 2, 3, 6 |
| Focus rebuilt each call; only confirmed facts carried onward | 3, 5, 6 |
| Bounded concurrency, per-room session CAS, safe cancellation | 4, 5, 7 |
| Action routing stops honestly before actual action execution | 6 |
| Call history and frontend snapshot isolation | 2, 8 |
| Full regression and accurate docs | 9 |

**Intentionally deferred:** Action-specific prompts and real Gemini Function Calling; actual action argument generation/validation; atomic `operationId` mutations, verified results and action-to-action cursor movement; Hallway Return/Output after real actions; question action implementation, IR, DB/distributed queue lease, SSE streaming. **Stage 1 does not complete requested Skill work.**

A subsequent design/plan must verify current Google documentation for the provider (https://ai.google.dev/gemini-api/docs/function-calling and https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures), decide `generateContent` vs Interactions API and preserve any continuation data correctly. Do not silently replace the existing JSON REST adapter while implementing this plan.

## Self-review completed (at plan-writing time)

- Every named interface consumed by later tasks is created in an earlier task.
- `createEngine` is the managed product interface; `createRequestRunner` is the one-request component; `createCallManager` never advances `planCursor`; `createCallRegistry` stores identity/route, not model payload.
- Failing tests exercise concurrency, cross-room access, CAS collisions, fake completions, abort races and public secret filtering.
- No Task invents a mutating action, revives deleted `workshop.js` or treats an Action Shell as a real Skill/Canvas execution.

## Execution handoff

User agreed to progress from the design to Superpowers planning. **This document is a plan, not execution approval.** Have the user review it before implementation. The most practical implementation method for these tightly coupled ESM interfaces is **native execution with a separate review after the branch is green**; choose subagent-driven review per Task instead if desired. Then invoke `superpowers:executing-plans` or `superpowers:subagent-driven-development`, respectively.
