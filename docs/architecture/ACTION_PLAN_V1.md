# LLM ActionPlan v1

Baseline: main 582c193, APP_VERSION 2026.10.11.14. Product authority: VISION.md.

## Boundary

The model describes work. A deterministic compiler emits the existing ModelTurn;
GraphPatch, graph kernel, scheduler, functions and delivery stay canonical.
No additional model call, graph write, inferred definition, port conversion or
automatic task success is introduced. Existing ModelTurn decoding stays available
for in-flight clients and fixtures, but is not taught in the new local prompt.

## Contract

`contract: "action-plan.v1"`, optional message, actions, needs and executionIntent.
Actions use `action` plus semantic fields. Created selectors use `{kind:"created",alias}`;
existing nodes use `{kind:"existing",nodeId}`. Definition selectors additionally
support `{kind:"builtin",type}` and `{kind:"existing",definitionId,version?}`.
Omitted existing definition versions resolve only when exactly one supplied version exists.
Alias namespaces for nodes and definitions are separate; duplicate declarations in either fail.

| Semantic action | Internal representation |
| --- | --- |
| node.define | patch.definitions; optional createInstance |
| definition.revise | complete definition draft with supersedes |
| node.add / update / delete | corresponding patch operation |
| definition.appearance / delete | corresponding patch operation |
| link.add / remove | corresponding patch operation |
| execute (node targets, closed/open) | run.start |
| execute (function target, fresh inputs) | function.run |
| function.save | existing function draft, semantic IO unchanged |
| question.ask | existing question contract |
| needs | existing read contract |

Consecutive graph edits form one atomic patch. Graph edits precede execution/save/question;
subsequent edits require a fresh turn with actual ActionResults and state. This retains
every existing single GraphPatch operation, including complete semantic revisions,
custom tool/subgraph definitions and multi-source flow/data graphs. Active-run adoption
is already rejected by the local kernel and is not exposed. Durable cancel/retry/complete
and unimplemented run.revise are not advertised to the local browser host.
Created-node updates fold into their declared node.add; persistent updates use nodeId.
Function graph maps accept explicit node selectors as well as persistent node IDs.
For created aliases, the first compilation returns canonical graph actions and trusted
continuation metadata. After those actions succeed, the client supplies their exact
createdRefs and fresh snapshot to a compiler-only endpoint. It emits canonical save
actions with actual IDs. No additional model call or stored IR format is introduced.

## Compilation and safety

Validate the closed semantic envelope and fields before resolving selectors. Allocate
keys by declaration order. Resolve exact builtins from the server catalog and existing
definitions from the snapshot. Preserve explicit ports; only omitted model_task ports
use the kernel's existing defaults. No first-definition fallback.

Validate generated ModelTurn with the frozen domain schema and preview graph edits in
an isolated MemoryGraphRepository using the same kernel. This is validation only;
the real repository is unchanged. Revision checks remain at the actual commit boundary.
Incident links are removed only for explicit removeIncidentLinks:true; definitions in
other conversations remain subject to the browser storage deletion guard.

executionIntent is a model declaration, not permission minted by the compiler.
Compilation requires runtime execution availability from the host and explicit model
executionIntent. The existing model layer interprets the current natural-language
request and constraints, including edit-only requests, questions and no-run instructions.
The server does not classify request wording. Runtime availability is not independent
proof of natural-language authorization. History and graph content never grant permission.
Function inputs are checked against supplied contracts; truncated contracts require a
read, not fabricated defaults.
Actions depend on earlier actions so partial failure prevents later execution/save.
Empty actions do not imply task completion.

## Provider decision

Use a small closed wire envelope with `{action,payloadJson}` items for structured
providers and direct semantic objects for JSON-only providers. Both decode to the same
versioned ActionPlan. Semantic payloads retain arbitrary actual JSON input values.
This uses the already supported object/array/string/nullable subset, preserving the
gateway's schema fallback. Typed union transport remains unverified against live APIs.
References: https://ai.google.dev/gemini-api/docs/structured-output and
https://console.groq.com/docs/structured-outputs (checked 2026-10-11).

## Implementation plan

- [x] M2: Test node creation, dynamic definitions, exact selectors, atomic edits and
  permissions before implementing compileActionPlan(plan, context).
- [x] M3: Test direct and projected local host output, safe repair paths, legacy
  decoding and support filtering before switching the output boundary.
- [x] M4: Teach only semantic work and preserve the existing behavior/permission rules.
- [x] M5 (offline): Run compiler and existing regression suites, inspect diff/version.
  Publish together as one commit against the unchanged latest main.

Review focus: ambiguous definition versions; model self-authorization; deletion racing
with user edits; a failed patch followed by execution; partial saved-function indexes.
No live-model success rate, latency or token-usage claim follows from offline checks.

## Review and verification record

- Removed request-word classifiers from both ActionPlan and legacy ModelTurn paths.
  The model interprets user intent; the host checks runtime availability and declared intent.
- Fixed settings loss when an inputs-only update preceded a request update.
- Isolated preview IDs cannot collide with existing graph identities.
- Added deterministic created-selector function-map binding through ActionResults,
  including failure stops and the existing question checkpoint lifecycle.
- Model-facing capability names and outputContract now agree with the semantic schema.
- Existing frozen domain schema, graph kernel and node/scheduler paths are unchanged.
- `npm test`: 745 tests passed, zero failures/skips (2026-10-11).
- Follow-up removal of request-word checks: 53 focused regression tests passed;
  the full suite was not rerun for this correction.
- `git diff --check` passed; APP_VERSION is 2026.10.11.16.
- Example create-and-run wire JSON: legacy 564 UTF-8 bytes, semantic 375 bytes.
  This is a fixture size comparison, not generated-token or performance measurement.
- Live-model first-attempt validity, latency, unintended actions and task success rates
  remain unmeasured. Gemini/Groq provider transport and fallbacks are tested offline.
