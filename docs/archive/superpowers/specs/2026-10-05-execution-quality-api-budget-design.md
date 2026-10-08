# Execution quality and API budget design

Date: 2026-10-05

## Goal

Raise ovll workflow execution quality substantially without increasing normal Gemini API request count.

The execution pipeline should:
- preserve meaningful source structure and enough source content for the model to do the requested work
- spend additional reasoning only on node types that benefit from it
- keep normal successful execution at the minimum practical request count
- prevent retries, fallback, finalization, cache reuse, and cancellation from silently multiplying requests
- make token and request usage measurable without logging user content
- preserve the current RuntimeEngine graph semantics and the existing grouped-execution architecture

This design extends, rather than replaces, `docs/superpowers/specs/2026-10-04-gemini-group-execution-design.md`.

## Non-goals

This work does not:
- replace Gemini with another provider
- move the whole application to a stronger or more expensive model
- add live web search or paid grounding
- make Gemini stateful with stored interaction history
- change the workflow planner protocol
- redesign canvas/chat/library UI
- increase prompt limits merely to hide bad compaction behavior

## Current root causes

The current implementation has several quality and quota problems at component boundaries.

### 1. Structured text is flattened before Gemini

`front/js/api.js` uses `clipPayloadText()` for generic execution values. That helper collapses all whitespace with `/\s+/g`, so paragraphs, Markdown lists, indentation, and code formatting can be destroyed before the request reaches the server.

Execution content and compact single-line metadata currently share the same compaction behavior even though they have different requirements.

### 2. Uploaded text can be read at 12,000 characters but delivered at a much smaller nested-string budget

Uploaded text preview is preserved at up to 12,000 characters in the canvas/workspace path.

The generic nested `compactPayloadValue()` path applies a smaller string limit at deeper nesting. File text reaches Gemini through nested input objects, so useful source content can be truncated long before the group-level input budget is actually exhausted.

This means the system may discard source evidence while unused request budget remains.

### 3. Partial cache hits can destroy grouping

Runtime grouping normally batches safe linear Gemini nodes into one request.

The current partial-cache path changes behavior when any intermediate cached entry exists. Cache misses are then executed one node at a time instead of regrouping adjacent misses.

A linear group can therefore require more API requests after a cache entry exists than it required without caching.

### 4. Cache identity does not cover all model-visible continuity context

Gemini execution receives `userRequest` and conversation memory.

The runtime cache context currently includes conversation identity and user request but not the normalized memory snapshot supplied to Gemini. Two executions with the same short request and different continuity memory can therefore share a fingerprint even though the model-visible meaning changed.

### 5. Retry and fallback share one broad escalation policy

The current model loop can retry transient failures several times and then attempt the fallback model for classes such as rate limits, server errors, or network failures.

This mixes three distinct mechanisms:
- transient retry
- structured-output repair
- model-availability fallback

Under degraded service conditions this can multiply calls without improving the probability of a useful answer.

### 6. Final synthesis is effectively an unconditional additional model stage

After runtime execution, the app calls the Gemini finalizer even for outcomes where deterministic local text is already sufficient, including simple artifact completion and failed runs.

This adds latency and one more retry/fallback surface to many executions.

### 7. Browser cancellation does not cancel the upstream Gemini request

Runtime cancellation aborts the browser request to ovll's server.

The Express handler does not currently propagate client disconnect/abort into an `AbortSignal` used by the server-to-Gemini fetch. A user-visible cancelled run can therefore continue consuming upstream work and retry budget.

### 8. Group-size validation is inconsistent across boundaries

Runtime checks the serialized execution group before adding request context.

Server validation checks the normalized group including `userRequest` and memory against the same configured total. A payload can pass the runtime guard and then fail at the server solely because context was added later.

## Design principles

### Preserve information before buying more intelligence

The first quality improvement is to stop damaging model input.

A stronger model must not be used to compensate for avoidable client-side flattening or truncation.

### Normal success should not become more expensive

For the same graph and unchanged grouping boundaries, the expected number of Gemini calls for a normal successful run must stay equal or decrease.

Selective thinking changes token use, not request count.

### Failure mechanisms have separate budgets

Retry, repair, and fallback solve different failure classes and must have independent caps.

No generic `maxAttempts` loop should be able to cascade through all of them.

### Cache is an optimization, never a semantic input

A cache hit must produce the same model-visible result as recomputation for the same effective inputs and continuity context.

Adding a cache entry must not increase request count for adjacent cache misses.

### Runtime remains authoritative

RuntimeEngine continues to own:
- dependency order
- scope
- branch activation
- node state
- failure propagation
- grouping boundaries

Gemini never decides graph topology.

## Proposed architecture

Keep the existing high-level flow:

`planner -> RuntimeEngine -> browser API adapter -> server Gemini execution -> RuntimeEngine commit -> optional final response`

Refine four boundaries:

1. browser payload shaping becomes structure-preserving and budget-aware
2. RuntimeEngine cache execution becomes segment-aware
3. Gemini execution gets explicit request-budget policy and per-request thinking selection
4. finalization and cancellation become conditional/end-to-end rather than unconditional/local-only

## 1. Structure-preserving payload compaction

Split text compaction into two semantic classes.

### Compact metadata text

Use for:
- user-facing request labels where formatting has no semantic role
- filenames
- MIME strings
- IDs
- short memory sentences
- other intentionally single-line fields

Behavior:
- normalize CRLF
- collapse repeated horizontal/vertical whitespace to a single space
- trim
- enforce the field limit with head/tail preservation where useful

### Structured execution text

Use for:
- uploaded text
- Markdown
- source code
- upstream node outputs
- document-like generated content
- any arbitrary string nested in execution inputs unless explicitly identified as metadata

Behavior:
- normalize CRLF to LF
- remove NUL characters
- preserve newlines and indentation
- do not run `/\s+/g`
- truncate only according to an explicit content budget

The generic execution-value compactor must default to structured preservation. Metadata callers must opt into flattening, never the reverse.

### Budget allocation

Do not simply raise the whole group limit.

For each group:
- reserve fixed space for node IDs/types, connections, user request, and normalized memory
- allocate the remaining content budget across node params and external inputs
- favor actual source/input content over repeated descriptive metadata
- when truncating long strings, preserve both the beginning and end with a clear omission marker
- preserve a `truncated` signal when the original source is known to be incomplete

The browser and server must calculate against the same effective request shape.

## 2. Cache-aware segmentation

A planned Gemini group remains the initial optimization unit.

Before execution:
1. walk the group in dependency order
2. test each non-pivot node against the cache using its current effective inputs and cache context
3. commit valid cache hits locally
4. collect consecutive cache misses into maximal safe execution segments
5. call `runGroup` once for each miss segment, not once per node

Example:

`A -> B -> C -> D -> E`

If only C is a valid cache hit:
- execute `[A, B]`
- commit cached C
- execute `[D, E]`

If A and B are cached:
- commit A and B
- execute `[C, D, E]`

A cache entry may reduce request count or leave it unchanged. It must not create avoidable one-node calls.

### Cache fingerprint

The fingerprint must represent all deterministic model-visible inputs for that node execution:
- node type
- effective node params
- collected upstream inputs
- conversation identity where needed for isolation
- latest user request as normalized for execution
- normalized conversation memory actually supplied to Gemini
- execution-policy version

The policy version allows deliberate invalidation when prompt/compaction semantics change.

Do not include volatile timestamps or runtime IDs.

## 3. Thinking policy

Keep the default execution model unchanged initially.

Do not globally upgrade model tier.

Select `thinking_level` deterministically from the requested group.

Initial policy:
- simple `organize` and `convert` groups: `minimal`
- groups containing `research`, `write`, or `judge`: `low`
- `medium`: only for an explicit future high-complexity policy with tests and telemetry evidence
- `high`: never selected automatically in this change

For mixed groups, use the highest required level among included nodes.

The finalizer, when used, stays `minimal` because it should synthesize existing results rather than redo the reasoning.

Environment override may still force a level for diagnostics, but normal production behavior uses the deterministic policy.

## 4. Explicit call budget policy

Replace broad retry/fallback behavior with independent budgets.

### Normal request

One primary-model request.

### Structured-output repair

When the HTTP request succeeded but the returned structured value fails semantic validation:
- allow exactly one repair request
- use the same model
- include only the compact validation failure description
- do not fallback because of a semantic mismatch

### Transient transport retry

For network errors or retryable server-side 5xx:
- allow at most one additional request on the same model
- use bounded exponential delay with jitter
- preserve `Retry-After` when supplied

### Rate limit

For HTTP 429:
- honor `Retry-After` when present
- allow at most one retry on the same model
- do not fallback to another model merely because the project/account is rate limited

### Model availability fallback

Use fallback only when the selected primary model is unsupported, unavailable, or not found for that request/configuration.

Fallback receives its own single normal attempt. It does not inherit a fresh multi-retry budget by default.

### Budget accounting

Every execution response should expose non-content diagnostics sufficient to know:
- primary attempts
- repair attempts
- transient retries
- fallback attempts
- selected model(s)
- selected thinking level

The browser may use these for internal diagnostics but should not expose raw token/account details in ordinary user messages.

## 5. Conditional finalization

Add a deterministic local final-response decision before calling Gemini.

Skip the model finalizer when:
- the run failed and a suitable user-facing runtime error already exists
- the only user-visible outcome is one or more created artifacts and no synthesis is required
- there is a single terminal Gemini result that is already a complete user-facing answer
- the run was cancelled

Use the model finalizer when:
- multiple independent successful branches need synthesis
- the terminal result is structured/non-user-facing data that needs a concise answer
- partial success requires combining successful results and limitations into one response

The local fallback remains available if model finalization fails.

This turns finalization from a mandatory stage into an exception for cases where synthesis adds value.

## 6. End-to-end cancellation

Cancellation must propagate across every active boundary.

Browser:
- RuntimeEngine aborts the API request using its existing run `AbortController`.

Server:
- create a per-request `AbortController`
- abort it when the incoming request is aborted or closes before completion
- pass its signal into Gemini execution
- stop pending retry sleeps when aborted
- never start fallback/repair/retry after abort

Gemini client:
- pass `signal` into `fetch`
- normalize abort as a non-retryable cancellation error

A cancelled request must not be counted as a service failure and must not start a finalizer request.

## 7. Consistent input-size enforcement

Define one request-budget constant and one canonical normalized request-shape estimator.

Runtime may use the shared policy or a conservative equivalent, but server remains authoritative.

The budget includes:
- normalized group nodes
- connections
- latest user request
- normalized memory
- repair instruction when present

When a multi-node group exceeds the budget, RuntimeEngine should split it into maximal safe consecutive subgroups before sending.

A single node that still exceeds the server limit should fail with a clear typed error rather than silently discarding most of its source.

## 8. Usage and quality telemetry

Extend Gemini usage normalization when those fields are present:
- input tokens
- output tokens
- total tokens
- cached tokens
- thought tokens
- tool-use tokens

Record per model request:
- request stage: execution / repair / finalizer
- model
- thinking level
- attempt reason
- duration
- token totals
- cache-token count
- result status
- whether fallback was used
- whether the request was aborted

Do not log:
- raw prompt text
- uploaded file contents
- conversation memory text
- generated document bodies

Telemetry is for comparing policy choices, not for storing user content.

## 9. Server/module boundaries

Avoid adding more responsibilities to `server.js`.

`geminiExecution.js` remains the owner of:
- request construction
- model/thinking selection
- Gemini fetch
- retry/repair/fallback policy
- usage normalization
- structured response validation

`server.js` remains responsible for:
- endpoint routing
- HTTP request lifecycle
- cancellation propagation
- safe response/error mapping
- APP_VERSION bump for deployment

`front/js/api.js` owns transport-safe payload shaping only.

`front/js/runtimeEngine.js` owns grouping, cache segmentation, and node state.

`front/js/app.js` owns final-response decision and user-visible presentation.

Do not add a second parallel execution path.

## 10. Testing strategy

No live Gemini key is required for automated tests.

### Payload fidelity tests

Add tests proving:
- Markdown paragraphs and lists preserve newlines through execution payload compaction
- source-code indentation survives
- metadata fields still compact to one line where intended
- nested uploaded text is not reduced to the old deep-string cap when group budget remains
- truncation preserves head/tail and a truncation indicator

### Runtime cache tests

Add tests proving:
- no-cache linear chain is one group call
- one cache hit in the middle produces two maximal miss groups, not one call per miss
- adjacent cache hits do not increase calls
- memory changes invalidate model-result cache
- user-request changes invalidate cache
- param/input changes still invalidate cache
- pivot semantics remain unchanged

Update the existing cache test whose current expected one-node calls encode the undesirable behavior.

### Gemini policy tests

Add deterministic tests proving:
- simple organize/convert group uses minimal thinking
- research/write/judge group uses low thinking
- semantic failure permits one same-model repair only
- 5xx/network failure permits one same-model retry only
- 429 does not trigger fallback
- unavailable/unsupported model may trigger one fallback attempt
- abort stops retry/fallback/repair
- usage normalization includes cached/thought/tool-use tokens when present

### Finalizer tests

Add tests proving:
- failed run does not call Gemini finalizer
- cancelled run does not call finalizer
- artifact-only run uses deterministic local response
- single complete terminal text can bypass finalizer
- multiple successful branches still invoke synthesis
- finalizer failure falls back locally without a second uncontrolled escalation path

### Request-size tests

Add tests proving:
- runtime and server agree on the same normalized request size
- context overhead is included before group dispatch
- oversized multi-node groups split before network execution
- oversized single-node input returns a typed error

### Cancellation tests

Use stubbed fetch/sleep:
- browser abort reaches the server execution signal in integration-level helper coverage where practical
- Gemini fetch receives an aborted signal
- no additional request starts after cancellation

## 11. Rollout

Implement in this order:

1. Add failing tests for payload fidelity and current cache/request amplification.
2. Replace execution text compaction with structure-preserving compaction.
3. Add canonical request budgeting and align runtime/server limits.
4. Replace partial-cache one-node execution with maximal miss segmentation.
5. Add memory/policy version to cache identity.
6. Split retry, repair, and fallback budgets.
7. Add deterministic thinking selection.
8. Propagate cancellation to Gemini fetch/retry sleep.
9. Make finalization conditional.
10. Add usage telemetry fields and safe diagnostic metadata.
11. Run the full test suite.
12. Bump `server.js` APP_VERSION as part of the deployed code change.

Do not change the default model during this rollout.

## Success criteria

The change is successful when all of the following are true:
- structured text reaches Gemini with paragraph/code/list formatting intact
- useful uploaded text is limited by the group budget rather than an accidental nested-string cap
- a cache hit never causes avoidable per-node API calls
- memory changes cannot reuse semantically stale cached Gemini output
- a normal linear workflow uses no more Gemini requests than before
- 429/5xx/network failures have a hard bounded request multiplier
- ordinary failures, cancellations, and simple artifact completion do not spend a finalizer call
- cancelling a run aborts upstream Gemini work and prevents further retries
- token/thought/cache usage can be measured without storing prompt content
- the complete existing test suite still passes
- every deployed implementation change updates `server.js` APP_VERSION
