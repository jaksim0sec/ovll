# vNext PostgreSQL runtime — opt-in, not deployed

Status: P1 node-execution vertical slice plus frozen-contract validator and opt-in standalone composition, isolated from legacy `server.js`.
Requires PostgreSQL 14+; CI tests PostgreSQL 16. No operational DB has been provisioned or modified by this change.

## Modules
- `graph.js` — shared semantic GraphPatch validation and independent revision snapshots.
- `durable.js` — transactional tenant-scoped Graph/Task/Run/ActionLedger/Event repository, advisory-locked idempotency, queue lease and recovery.
- `durableHttp.js` — **standalone** authenticated HTTP + event replay/SSE. Host must supply trusted `authenticate` and `verifyMutation` (CSRF) callbacks.
- `worker.js` — lease renewal and epoch-checked settlement; the composed runtime supplies the node executor.
- `executionPlan.js` — pinned revision, closed/open scope, DAG ordering and input preflight. Conditional routing and subgraphs fail closed.
- `nodeExecution.js` — durable per-node Attempts, artifacts/provenance, lease + execution-owner fencing, atomic output/event writes, successful-attempt recovery and completion evidence.
- `nodeOutput.js` — frozen `NodeOutput` inline/ref contract, required ports, representation, bytes/depth and JSON-value validation.
- `validation.js` — pinned Ajv 8.20.0 Draft 2020-12 validator for all frozen contract definitions. Does not coerce or mutate model output.
- `runtime.js` — composes the schema validator, durable store, node executor, worker and authenticated standalone Express app. Does not listen automatically or mount legacy routes.
- `sql/001_initial.sql` then `sql/002_node_evidence.sql` — ordered migrations, including requester/execution fencing, per-node generations and artifact storage. The new store requires both; run via a dedicated migration process, not app startup. Existing queued Runs with no requester remain execution-denied until an authorized migration/reconciliation establishes ownership.
- `providers.js` — vendor-agnostic model gateway; **not yet integrated** with durable worker.

## Important fail-closed boundaries
- Nothing in vNext is currently mounted by `server.js`. No production DB configuration, credentials or driver is committed.
- `PostgresVNextStore({pool, validateTurn, verifyRunEvidence})` requires a working real PostgreSQL pool and an **actual schema validator**. `createVNextRuntime` supplies the frozen-schema validator; custom composition must provide an equivalent validator. A permissive validator used in tests is **not suitable for production**. ModelTurn must be validated against the frozen v1 JSON Schema and then semantically verified.
- `verifyRunEvidence` is required before a Run can be `completed`. Missing hook -> `RUN_VERIFICATION_UNAVAILABLE`. Task completion and function verification are separate decisions.
- The server authenticates the actor/workspace and checks membership on every read/mutation; client-supplied actorRef is ignored. The privileged `provisionWorkspace` function must never be exposed to clients.
- HTTP mutation requires a trusted `verifyMutation` (CSRF/bearer policy) callback. For browser cookie auth use SameSite and CSRF protections; do not use anonymous/demo callbacks in production.
- The queue is transactional with Run; action ledger uses workspace+actor+request+localKey plus PostgreSQL advisory transaction locks. Patch/ledger/event are committed atomically. A lease token prevents late worker results from overwriting state.
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
```
The integration suite uses an isolated disposable test database, not user data.

## Remaining gate before frontend cutover
1. Production session/auth provider + migrations/connection pool/deployment storage strategy and backup/restore.
2. General artifact/file InputBinding resolution, conditional flow semantics and verified capability catalog. Frozen Draft 2020-12 form validation is implemented; it does not prove semantic safety or external truth.
3. Conditional branch/merge/subgraph semantics, active planEpoch adoption, partial invalidation and persisted retry/Question state machines. Straight-line DAG Attempts/provenance and pure-model lease recovery are implemented.
4. Implement other action types (run.revise/retry/cancel proposal, task.complete, question.ask, function.save) with authoritative state machines.
5. Integrate real vendor model adapters and prompt composer; validate actual output/usage/errors/cache before reporting quality.
6. Canvas semantic ↔ existing UI adapter, cursor re-sync and full UX regression check; preserve UI visual controls.
7. Resolve 12 pre-existing mascot/node UI test failures separately; existing vNext changes must not mask them.

**P1 done ≠ runtime done:** This slice proves persistence, authorization boundary, transactional queue and lease safeguards, not autonomous task completion or production readiness.

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

Next order: authoritative Task/Question/Retry/Cancel transitions → branch/merge and explicit planEpoch adoption → FunctionVersion save/verify/reuse → real provider/Prompt Composer → Canvas cutover. No unchecked item is implied complete by this vertical slice.
