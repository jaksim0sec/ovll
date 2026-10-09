# OvllPointer lifecycle implementation plan

> Agentic executor: use Superpowers executing-plans with TDD. The user explicitly authorized autonomous inspection/design/implementation/verification without approval prompts. Batch changes at tested subsystem milestones; preserve legacy UI and frozen contracts.

**Goal:** persist questions and explicit retry/cancel proposals, and prevent Task completion without actual verified outcomes.
**Architecture:** a lifecycle module implements transitions inside the durable store's existing action/ledger/event transaction. Trusted outcome validation is separate from LLM claims. Question answers are user facts, not execution artifacts; frozen Question references an immutable answer record.
**Tech:** Node 22+, PostgreSQL16, existing Ajv frozen schema, Express.
**Spec:** docs/architecture/DATA_CONTRACT_V1_FREEZE.md and DATA_CONTRACT_PROPOSAL_V1.schema.json. This plan supplies state transition rulings without modifying those contracts.

## Constraints and decisions
- No legacy mounting or frontend changes. Main only; bump server.js APP_VERSION.
- Task lock precedes Question/Run lifecycle locks; scheduling must also lock Task before accepting active state.
- Question.ask creates open Question + waiting Task + event atomically; ActionLedger owns idempotency with unambiguous JSON tuple keys, scope-bound signatures and request-level advisory serialization. Older delimiter keys are checked by original Action ID; an older signature without scope fails closed rather than replaying a mutation. blockedActions refer to existing local keys in the same turn, mapped to authoritative Action IDs. Unknown, self, past, or already-ledgered references are rejected. Open Questions reject their future actions; after an answer the host resubmits the same turn/request to continue. No durable proposal payload replay is implied. Question.ask without blockedActions prevents new Run scheduling through Task.waiting but does not pause previously queued/running work.
- answerQuestion requires membership/editor permission, locks Task before Question, stores one immutable answer record, and reactivates Task only after all open questions are answered. Same identical answer is idempotent; contradictory second answer is a conflict. Answering does not execute pending work automatically.
- Explicit run.retry accepts only a selected failed node's latest failed Attempt in a failed Run or a model-only waiting Run. Active/completed/cancelled Runs, stale attemptRef and all unknown external outcomes are rejected. Successful predecessors survive. Retry requeues the same frozen Run/epoch; partial invalidation/adoption stays pending.
- run.cancel reuses the host cancellation transition inside the action transaction. Late output writes are fenced. Running pure-model Attempts become cancelled; uncertain tool Attempts remain outcome_unknown.
- task.complete requires distinct real artifacts from successful Attempts of completed Runs belonging to the same Task, no queued/running/waiting Runs and no open Questions. Always require a trusted verifyTaskOutcomes callback with a finite deadline; absent callback never means success. Check requiredOutcomes evidenceRefs against submitted outcomes. Snapshot Task.completed is separate from Run.completed.
- Questions/answers and Task reads are workspace-scoped HTTP APIs. Raw answers use the same JSON/bytes/depth limits as model data.
- Existing Failed Task DB state conflicts with frozen Task.blocked: additive migration accepts blocked while retaining legacy failed rows; new lifecycle writes only frozen states.

## Review focus
1. Concurrent question answer vs question creation/Task completion: consistent Task-first locks, no premature activation/completion.
2. Explicit retry after tool outcome_unknown: refuse even if the caller supplies another node/Attempt.
3. Queueing a Run while Task completion is verifying: serialized Task locks prevent post-completion scheduling.
4. Missing/foreign/stale outcome evidence: reject before trusted verification and before any completion event.
5. Late output after action cancellation: no Artifact/success persistence and no continued Run completion.

## Task 1 — Question persistence
Files: lifecycle.js, sql/003_lifecycle.sql, durable.js, durableHttp.js, test/ovllPointerLifecycle.integration.mjs.
Interfaces: askQuestion(client,scope,args,actionId,knownActions), answerQuestion(client,scope,questionRef,answer), readTask/readQuestion store methods.
- [x] Write tests: atomic open/waiting state; duplicate action no duplicate question; two Questions require two answers; foreign workspace denied; identical answer idempotent and changed answer rejected.
- [x] Run tests RED, implement Task-first transactions and migrate 003, rerun GREEN.

## Task 2 — Explicit retry/cancel
Interfaces: retryRun(client,scope,args) returns runRef; cancelRun(client,scope,runRef) shares existing cancellation behavior with direct API.
- [x] Write tests: failed node retries with new generation and predecessor reuse; successful/active/unknown-tool/stale-attempt retry rejected; proposal cancellation is idempotent and fences delayed output.
- [x] Run RED, implement inside existing submit ledger transaction, rerun GREEN.

## Task 3 — Task completion and standalone composition
Interfaces: completeTask(client,scope,outcomeRefs,verifyTaskOutcomes,maxValidationMs), runtime optional verifyTaskOutcomes injection.
- [x] Write tests: missing verifier/foreign evidence/pending Question/pending Run refusal; independently completed Run does not complete Task; finite verifier timeout; verified Task completes once and refuses later scheduling.
- [x] Run RED, implement bounded trusted semantic gate and Task-first scheduling lock, rerun GREEN.

## Acceptance and checkpoint
- [ ] Real PostgreSQL16 integration, all existing OvllPointer suites, full app baseline comparison, syntax and diff checks.
- [x] Reviewer findings resolved by failing regressions then rerun; update README/master checklist.
- [ ] Batch publish to main and inspect native CI logs; keep 12 baseline UI failures named, never remove tests to make green.
- [ ] Next P1: conditional routing/merge/subgraph and planEpoch adoption, then immutable FunctionVersion storage/verification/reuse. No success claim for these pending items.

## Evidence before publish
- Frozen unit suite 74/74. SQL smoke: persistence13/13, node execution25/25, lifecycle25/26 with one explicitly skipped multi-session race. Native PostgreSQL CI must run all26 without skip.
- Reviewer regressions: blocked action execution, cross-Task ledger replay, mixed Question/answer read, model cancellation in tool DAG, colon-key ledger alias. All fixed with RED→GREEN evidence.
- Full app296/308; same12 prior UI failures and no new names. Never modify these tests in this subsystem.
- Native CI and main batch commit remain the final acceptance gate; see workflow logs for the actual published revision.
