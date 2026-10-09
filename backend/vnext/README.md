# vNext PostgreSQL runtime — opt-in, not deployed

Status: P1 durable foundation implementation, isolated from legacy `server.js`.
Requires PostgreSQL 14+; CI tests PostgreSQL 16. No operational DB has been provisioned or modified by this change.

## Modules
- `graph.js` — shared semantic GraphPatch validation and independent revision snapshots.
- `durable.js` — transactional tenant-scoped Graph/Task/Run/ActionLedger/Event repository, advisory-locked idempotency, queue lease and recovery.
- `durableHttp.js` — **standalone** authenticated HTTP + event replay/SSE. Host must supply trusted `authenticate` and `verifyMutation` (CSRF) callbacks.
- `worker.js` — opt-in worker lease renewal; host must supply trustworthy actual `executeRun`; worker is NOT a complete node scheduler.
- `sql/001_initial.sql` — initial migration. Run through a dedicated migration process after DB backup, not automatically at app startup.
- `providers.js` — vendor-agnostic model gateway; **not yet integrated** with durable worker.

## Important fail-closed boundaries
- Nothing in vNext is currently mounted by `server.js`. No production DB configuration, credentials or driver is committed.
- `PostgresVNextStore({pool, validateTurn, verifyRunEvidence})` requires a working real PostgreSQL pool and an **actual schema validator** supplied by the host. A permissive validator used in tests is **not suitable for production**. ModelTurn must be validated against the frozen v1 JSON Schema and then semantically verified.
- `verifyRunEvidence` is required before a Run can be `completed`. Missing hook -> `RUN_VERIFICATION_UNAVAILABLE`. Task completion and function verification are separate decisions.
- The server authenticates the actor/workspace and checks membership on every read/mutation; client-supplied actorRef is ignored. The privileged `provisionWorkspace` function must never be exposed to clients.
- HTTP mutation requires a trusted `verifyMutation` (CSRF/bearer policy) callback. For browser cookie auth use SameSite and CSRF protections; do not use anonymous/demo callbacks in production.
- The queue is transactional with Run; action ledger uses workspace+actor+request+localKey plus PostgreSQL advisory transaction locks. Patch/ledger/event are committed atomically. A lease token prevents late worker results from overwriting state.
- **Unknown external side effects:** a timed-out leased tool_task becomes `outcome_unknown` and `Run.waiting`, not an automatic retry. This conservative policy applies to all tool_task definitions until a verified capability effect catalog exists.
- `GraphRevision` is pinned to a Run at scheduling. Revision edits do not mutate active-run plans.
- SSE is best-effort transport; DB `ov_events` is the source of truth. `GET /api/vnext/events?after=N` is a short-poll fallback. For serverless Vercel Functions, do not assume indefinite SSE connections are supported.
- P1 uses PostgreSQL through an **injected driver pool**; declare/pin a PostgreSQL driver in production runtime dependencies and configure TLS/network/pooled credentials before deployment.

## Test
On GitHub Actions, `vnext-postgres-integration` starts PostgreSQL 16, installs the `pg` test driver and runs:
```sh
node --test test/vnextFoundation.test.js
VNEXT_TEST_DATABASE_URL=postgresql://... node --test test/vnextPostgres.integration.mjs
```
The integration suite uses an isolated disposable test database, not user data.

## Remaining gate before frontend cutover
1. Production session/auth provider + migrations/connection pool/deployment storage strategy and backup/restore.
2. Full Draft 2020-12 ModelTurn/GraphPatch Node runtime validator; InputBinding, port flow semantics, read permissions & capability registry.
3. Durable per-node Attempts, output provenance, DAG scheduler (branch/merge), planEpoch adoption, crash recovery/fencing at node granularity, durable artifact record.
4. Implement other action types (run.revise/retry/cancel proposal, task.complete, question.ask, function.save) with authoritative state machines.
5. Integrate real vendor model adapters and prompt composer; validate actual output/usage/errors/cache before reporting quality.
6. Canvas semantic ↔ existing UI adapter, cursor re-sync and full UX regression check; preserve UI visual controls.
7. Resolve 12 pre-existing mascot/node UI test failures separately; existing vNext changes must not mask them.

**P1 done ≠ runtime done:** This slice proves persistence, authorization boundary, transactional queue and lease safeguards, not autonomous task completion or production readiness.
