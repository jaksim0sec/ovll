# vNext PostgreSQL runtime — opt-in, not deployed

Status: P1 node execution, frozen-contract validation, Task/Question/retry/cancel lifecycle and opt-in standalone composition, isolated from legacy `server.js`.
Requires PostgreSQL 14+; CI tests PostgreSQL 16. No operational DB has been provisioned or modified by this change.

## Modules
- `graph.js` — shared semantic GraphPatch validation and independent revision snapshots.
- `lifecycle.js` — authoritative Question/answer, explicit safe node retry, cancellation and independently verified Task completion.
- `durable.js` — transactional tenant-scoped Graph/Task/Run/ActionLedger/Event repository, advisory-locked idempotency, queue lease and recovery.
- `durableHttp.js` — **standalone** authenticated HTTP + event replay/SSE. Host must supply trusted `authenticate` and `verifyMutation` (CSRF) callbacks.
- `worker.js` — lease renewal and epoch-checked settlement; the composed runtime supplies the node executor.
- `executionPlan.js` — pinned revision, closed/open scope, DAG ordering and input preflight. Conditional routing and subgraphs fail closed.
- `nodeExecution.js` — durable per-node Attempts, artifacts/provenance, lease + execution-owner fencing, atomic output/event writes, successful-attempt recovery and completion evidence.
- `nodeOutput.js` — frozen `NodeOutput` inline/ref contract, required ports, representation, bytes/depth and JSON-value validation.
- `validation.js` — pinned Ajv 8.20.0 Draft 2020-12 validator for all frozen contract definitions. Does not coerce or mutate model output.
- `runtime.js` — composes the schema validator, durable store, node executor, worker and authenticated standalone Express app. Does not listen automatically or mount legacy routes.
- `sql/001_initial.sql`, `sql/002_node_evidence.sql`, then `sql/003_lifecycle.sql` — ordered migrations, including requester/execution fencing, per-node generations and artifact storage. The new store requires all three; run via a dedicated migration process, not app startup. Existing queued Runs with no requester remain execution-denied until an authorized migration/reconciliation establishes ownership.
- `providers.js` — vendor-agnostic model gateway; **not yet integrated** with durable worker.

## Important fail-closed boundaries
- Nothing in vNext is currently mounted by `server.js`. No production DB configuration, credentials or driver is committed.
- `PostgresVNextStore({pool, validateTurn, verifyRunEvidence})` requires a working real PostgreSQL pool and an **actual schema validator**. `createVNextRuntime` supplies the frozen-schema validator; custom composition must provide an equivalent validator. A permissive validator used in tests is **not suitable for production**. ModelTurn must be validated against the frozen v1 JSON Schema and then semantically verified.
- `verifyRunEvidence` is required before a Run can be `completed`. Missing hook -> `RUN_VERIFICATION_UNAVAILABLE`. Task completion and function verification are separate decisions.
- The server authenticates the actor/workspace and checks membership on every read/mutation; client-supplied actorRef is ignored. The privileged `provisionWorkspace` function must never be exposed to clients.
- HTTP mutation requires a trusted `verifyMutation` (CSRF/bearer policy) callback. For browser cookie auth use SameSite and CSRF protections; do not use anonymous/demo callbacks in production.
- The queue is transactional with Run; action ledger uses workspace+actor+JSON tuple(request,localKey), scope-bound signatures and request-level PostgreSQL advisory transaction locks. Older unscoped signatures return conflict rather than replaying effects; older delimiter rows are matched by original Action ID. Patch/ledger/event are committed atomically. A lease token prevents late worker results from overwriting state.
- **Unknown external side effects:** a timed-out leased tool_task becomes `outcome_unknown` and `Run.waiting`, not an automatic retry. This conservative policy applies to all tool_task definitions until a verified capability effect catalog exists.
- `GraphRevision` is pinned to a Run at scheduling. Revision edits do not mutate active-run plans.
- SSE is best-effort transport; DB `ov_events` is the source of truth. `GET /api/vnext/events?after=N` is a short-poll fallback. For serverless Vercel Functions, do not assume indefinite SSE connections are supported.
- P1 uses PostgreSQL through an **injected driver pool**; declare/pin a PostgreSQL driver in the standalone production host dependencies and configure TLS/network/pooled credentials before deployment.

## Test
On GitHub Actions, `vnext-postgres-integration` starts PostgreSQL 16, installs the `pg` test driver and runs:
```sh
node --test test/vnextFoundation.test.js test/vnextExecutionPlan.test.js test/vnextNodeOutput.test.js test/vnextValidation.test.js test/vnextRuntime.test.js
VNEXT_TEST_DATABASE_URL=postgresql://... node --test test/vnextPostgres.integration.mjs
VNEXT_TEST_DATABASE_URL=postgresql://... node --test test/vnextNodeExecution.integration.mjs
VNEXT_TEST_DATABASE_URL=postgresql://... node --test test/vnextLifecycle.integration.mjs
```
The integration suite uses an isolated disposable test database, not user data.

## Opt-in Prompt Composer and model node gateway
- `promptComposer.js` composes registered modules as stable Core → relevant layers → selected micro-instructions → separately serialized and schema-validated ContextBundle. Module IDs and paths are registry-controlled, not taken from model/user text.
- `modelExecutor.js` maps a pinned dynamic `model_task` to the injected ModelGateway. The trusted host must supply `loadModelContext` (including actual permitted source content) and `resolveModel`. Returned ModelTurn and NodeOutput must match the declared node port contract. Unknown capabilities and tool effects are never inferred.
- `createVNextRuntime({modelGateway,loadModelContext,resolveModel,...})` uses this executor when no explicit `executeNode` was injected. Legacy behavior is unchanged; vNext remains opt-in.
- `onModelUsage` is only optional telemetry and is not durable usage/cost accounting. No paid provider call, live quality evaluation, general needs loop or production cutover has occurred.

## Model-neutral controller and browser event contract (opt-in)
- `turnController.js` composes Core + entry by default, conditionally refines proposed IR/function/question actions with their reviewed specialized prompt layers, with trusted `selectTurnModules` supporting the other four behavior layers, context reads, and optional result-language stage. It validates ModelTurn and delegates proposals to the durable action service. It does not select a vendor-specific protocol; the supplied ModelGateway owns that.
- Host supplies `prepareTurnContext`, `resolveTurnModel` and optionally `fulfillTurnNeeds` (trusted, scoped and validated). Missing needs remain pending; no fabricated retrieval. `languageAfterActions` is optional and never certifies success.
- Server progress is emitted to the existing durable workspace event journal with membership checks. HTTP `POST /api/vnext/requests` is installed only when trusted controller dependencies exist and uses the existing authenticate + CSRF middleware; browser SSE uses a single `event: ovll` envelope with a monotonic cursor. Snapshot queries and polling stay available.
- `front/js/vnextApi.js` supports authenticated commands and cursor replay with SSE and polling. `app.js` connects an opt-in progress display behind `OVLL_RUNTIME.vnextEnabled`. This flag is **off by default**. Current Canvas geometry is not automatically mapped to vNext GraphRevision, nor have real provider/Auth/DB host deployments been configured. Do not switch production traffic before those integrations are verified.

## Read-only semantic graph projection & durable state replay (opt-in)
- `GET /api/vnext/state?graphId=...&taskRef=...` returns graph, last 25 matching runs and eventCursor atomically from one authorized read-only PostgreSQL snapshot. `GET /api/vnext/runs/:runRef/state` returns latest Attempt per node for the pinned plan epoch, including output references but not raw artifact values.
- `front/js/vnextProjection.js` maps dynamic `NodeDefinitionVersion` and exact semantic port names into a uniquely versioned canvas type without reducing dynamic node creation. Existing viewport/node positions are preserved by the Canvas layout renderer. Artifact values are fetched via the authorized `artifacts` route; `outputRefs` are **not** fabricated file download links.
- On vNext opt-in, front syncs canonical graph after actual server Patch, rehydrates Run Attempt states, and reconnects the durable event journal with cursor replay. Explicit node Run actions use authenticated `turns` API (not local browser execution). No production default switch; front graph editing still requires server-authoritative mutations before general roll-out.

## Remaining gate before frontend cutover
1. Production session/auth provider + migrations/connection pool/deployment storage strategy and backup/restore.
2. General artifact/file InputBinding resolution, conditional flow semantics and verified capability catalog. Frozen Draft 2020-12 form validation is implemented; it does not prove semantic safety or external truth.
3. Conditional branch/merge/subgraph semantics, active planEpoch adoption and partial invalidation. Straight-line DAG Attempts/provenance, explicit retry/Question state machines and pure-model lease recovery are implemented.
4. Implement other action types (run.revise and function.save) with authoritative state machines.
5. Integrate real vendor model adapters and prompt composer; validate actual output/usage/errors/cache before reporting quality.
6. Canvas semantic ↔ existing UI adapter, cursor re-sync and full UX regression check; preserve UI visual controls.
7. Resolve 12 pre-existing mascot/node UI test failures separately; existing vNext changes must not mask them.

**P1 done ≠ runtime done:** This slice proves persistence, authorization boundary, transactional queue and lease safeguards, not production readiness. Task completion requires independent host verification.

## Execution adapter and artifact read contract

Use `createVNextRuntime({pool, executeNode, workerRef, authenticate, verifyMutation, ...policy})` to assemble the standalone server. The host decides when to `app.listen` and invoke `worker.workOnce`; authentication, production DB/migrations, model/tool adapters and process scheduling remain host responsibilities.

`executeNode` returns the frozen NodeOutput directly:
```js
{status:'produced', values:{result:{inline:'actual result'}}}
{status:'produced', values:{result:{ref:'authorized_input_value_id'}}}
{status:'blocked', reason:'A required source is missing'}
```
A `ref` may resolve only an already-supplied input artifact with matching representation. Arbitrary workspace/file/ref discovery is not silently supported. `inputBindings` currently means inline JSON keyed by declared input port; undeclared/ambiguous bindings and missing `required:true` inputs are rejected before node calls.

Known representations: text/structured_text/document strings, finite number, boolean, JSON, object, array. Other representations require trusted `validateRepresentation({representation,value})`; this must verify the claimed format. Optional `validateNodeOutput` is an external content checker, separate from format/provenance validation. Its presence never makes model text objectively true. Artifact validation status records which gate ran. Reuse rejects contract-only evidence when stronger external checking is now required and rechecks configured external policy.

Bump `executionProfileId` when provider/model, prompts, tool implementation, validator semantics or execution policy changes. Custom representation validation and this profile must be shared by executor and evidence verifier; `runtime.js` handles this composition.

Budgets default to 512 selected nodes, 60 seconds per external/validation callback, 5 minutes per Run, 5 seconds total settlement validation, 32768 output bytes and depth 12. The worker signals cancellation; callbacks may ignore signals, so late external effects remain `outcome_unknown` and are never automatically replayed. Provider token/money budgets and explicit retry limits remain pending.

`GET /api/vnext/runs/:runRef` returns authoritative Run state. `GET /api/vnext/artifacts/:valueRef` returns `{artifact, content, validationStatus}` with the frozen ValueArtifact and the actual stored representation/value. `contentRef: content:<valueId>` identifies that row's immutable logical content; this is currently inline JSON storage, not external blob/file storage. Both routes authenticate and recheck workspace membership, and disable response caching.

The execution-owner reservation uses short DB transactions and no long-lived reserved connection, so a pool with one connection can execute. Reclaiming the lease rotates/clears ownership. Per-node unique indexes and repeated fences prevent duplicate or late writes. Run completion verifies every selected node and target evidence; Task completion stays independent.

## Verification evidence and next P1 work

Local verification: new-core 74/74; frozen fixtures 34/34; local PGlite SQL smoke 13/13 persistence and 25/25 execution. PGlite has one database session; native PostgreSQL 16 CI is the authoritative concurrency gate for this commit, not these local smoke results. Full legacy suite: 296/308, same 12 previously failing mascot/node UI tests.

Next order: branch/merge and explicit planEpoch adoption → FunctionVersion save/verify/reuse → real provider/Prompt Composer → Canvas cutover. No unchecked item is implied complete by this vertical slice.

## Task and Question lifecycle

`question.ask` persists a frozen open Question and Task.waiting atomically with its action ledger/event. `blockedActions` names future local keys in that turn, mapped to real Action IDs. Open Questions reject those actions; unknown/self/past/already-applied blockers are rejected. The host can resubmit the same turn and Idempotency-Key after answering; duplicate applied actions stay idempotent and previously blocked actions may proceed. Answering does not automatically call a provider or replay proposal payloads. Questions without blockers prevent new Run scheduling; they do not pause already queued/running Runs.

`POST /api/vnext/questions/:questionRef/answer` requires trusted auth, current editor membership and CSRF verification. Answers are immutable JSON facts with bytes/depth limits. Identical answer is idempotent; changed answer conflicts. Task returns to active only after every open Question is answered. Authenticated `GET /api/vnext/tasks/:taskRef` and `/api/vnext/questions/:questionRef` disable caching; Question and answer are read in one committed statement.

`run.retry` requeues the same failed/model-only waiting Run only for its latest failed selected-node Attempt. It preserves successful ancestors and creates a new failed-node generation. Live, completed, cancelled, stale-attempt and tool-containing Runs are refused; the conservative tool rule also covers tool nodes not yet invoked. `run.cancel` fences delayed output and cancels model Attempts while preserving uncertain tool Attempts as outcome_unknown. Neither transition completes Task.

`task.complete` requires real artifacts from successful Attempts of completed Runs in the same Task, distinct refs, required evidence, no open Questions and no pending Runs. Always inject `verifyTaskOutcomes({task,outcomeRefs,artifacts})`; only literal true completes Task. Missing callback fails closed and default deadline is 5 seconds (`maxTaskValidationMs`, maximum 30 seconds). Task-first locking serializes Question creation/answer, Run scheduling and semantic completion. The verifier receives cloned data without DB client; it must be an independent semantic checker, not a pass-through of model claims.

Lifecycle verification:26 PostgreSQL cases, 25/26 local single-session smoke with the multi-session completion/scheduling race explicitly skipped. Native PostgreSQL16 CI must pass all26 before acceptance. Existing unit 74/74 and SQL 13/13+25/25 remain green locally. See [lifecycle plan](../../docs/architecture/VNEXT_LIFECYCLE_PLAN.md).
