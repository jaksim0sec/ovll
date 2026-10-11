# Saved Function Output Delivery Implementation Plan

**Goal:** Preserve the saved public output contract through replay, run storage and chat/file delivery.

**Architecture:** Carry the existing `outputMap` from binding into the local runner. Validate it against the pinned execution plan before any work, then project verified node values into public outputs. Keep complete node results for graph inspection and preserve legacy functions without mappings.

**Spec:** `docs/VISION.md` §§3.1, 4, 5 and the existing saved function output contract in `front/js/ovllPointerFunctions.js`.

## Constraints
- Keep dynamic IR, execution authority, model adapters and ordinary node delivery unchanged.
- Never fabricate missing outputs, refs or artifact effects.
- Update `server.js` APP_VERSION and publish one verified commit on `main`.
- Real model quality and rendered browser/PDF quality require separate evidence.

## Task 1: Connect saved output contracts to execution and delivery

**Files:** `front/js/ovllPointerFunctions.js`, `front/js/app.js`, `front/js/ovllPointerLocal.js`, `front/js/ovllPointerLocalActions.js`, `test/ovllPointerFunctionDelivery.test.js`.

**Interfaces:** `bind` returns optional `outputMap` and mandatory public `requiredOutputs`; replay passes both to `runLocalNodes` and the local runner. A mapped run stores the contract, `functionOutputs` and `functionOutputRefs`. Chat delivery selects exact mapped ports and uses public names; complete node outputs remain available. Automatically qualified `nodeId:port` names are not printed as user-facing labels.

- [x] Reproduce missing public output projection, false completion when only an unselected optional port exists, invalid mappings, dependency outputs and unselected card/text delivery. Legacy behavior passed before production changes.
- [x] Validate saved mappings during binding and plan construction. No executor calls or run writes for invalid mappings.
- [x] Project only current successful results at finish, retaining exact source refs. At least one public output and every `required:true` public output must exist for completed delivery; optional outputs may be omitted.
- [x] Deliver mapped text/files, retain artifact effect verification and bound action evidence.
- [x] Review found incomplete dependency/cache reuse after adding a new public output. A prior/cached model result is reusable only if its selected public ports are present. Reproduction covers history and cache; execution scope and tool effects stay unchanged.
- [x] Run final `npm test`: 684/684 pass. Publication and remote CI status are tracked in issue #23 after the single commit is published.

## Review focus
- A node succeeds through an optional unrelated output while the selected output is missing.
- A public output points to an upstream dependency rather than the selected terminal node.
- Persisted mappings are malformed, out of scope, incomplete or have mismatched representations.
- A model object resembles an artifact without a confirmed tool effect.
- Legacy functions and direct node runs have no `outputMap`.

## Claude plan corrections
The 2026-10-11 session attachment predates current `main` (`89b39d6`). P0/P1 and N3/N4 already exist and must not be reimplemented. An exclusively typed decision, removal of temporary handles and unconditional dependency recovery remain rejected. No new real-model smoke can be claimed without model access. Prompt shrinking and typed-wire rollout remain evidence-gated; they are not required to repair this deterministic output delivery defect.

## Evidence and limits
Baseline `89b39d6`: 674/674 tests pass. Initial reproductions: five failures and one legacy pass. Three review regressions exposed internal labels, optional-output rejection and incomplete reuse; all ten delivery tests now pass. These tests exercise the real local planner/runner, function binding, run persistence and presentation with a fixed model executor. They do not establish Gemini answer quality, token savings, deployed browser layout or rendered PDF quality. Existing prompt/typed-wire proposals are not implemented by this change.

Independent review found no remaining Critical/Important issues after the reuse correction. A deferred minor is that missing optional selected ports also prevent model cache/history reuse; an exclusive-branch dependency mapped to both optional branch ports can therefore be recomputed. This preserves requested-output completeness at the reuse boundary but is not a cost optimization.
