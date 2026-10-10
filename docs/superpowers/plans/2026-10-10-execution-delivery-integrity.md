# Execution and artifact delivery integrity implementation plan

> **For agentic workers:** Use superpowers:executing-plans for integration and superpowers:dispatching-parallel-agents for independent bug domains. User authorized analysis and fixes together.

**Goal:** Keep graph inputs, verified execution and existing file cards consistent for PDF follow-up work.

**Architecture:** Preserve the shared graph kernel's single-producer checks. Translate explicit canvas reconnection into an atomic replacement of the literal input. Validate actual runtime values/evidence, expose prior result references, and hand confirmed artifact objects to the existing message/card renderer.

**Tech Stack:** Existing JavaScript browser runtime, shared ESM graph/planner, Node tests, stateless model host.

**Spec:** User incident report and docs/VISION.md, sections 3.2 and 5.

## Global constraints
- Main branch, no new branch/PR, one verified final commit.
- No live model API calls. Fixtures exercise real graph, scheduler and artifact code.
- Preserve dynamic definitions and valid independently bound exports. Never invent missing edges.
- Keep canonical ambiguity rejection, file preview/storage UI and existing output contracts.
- Bump APP_VERSION and shell cache for changed product assets.

## Review focus
- A new data edge replaces only its destination literal, preserving unrelated inputs.
- Flow-only links never provide values; empty or malformed outputs do not succeed.
- A PDF follow-up leaves valid earlier source results readable while semantic edits invalidate them.
- Cancelled/partial confirmed files remain available; stale or unconfirmed model URLs do not become cards.
- Actionless completion claims and unresolved reads do not masquerade as executed work.

## Task 1: Canvas binding replacement
Files: front/js/ovllPointerGraphPatch.js and test/ovllPointerGraphPatchBindings.test.js.
- [x] Reproduce binding+link ambiguity with builtin research/createFile.
- [x] Atomically clear only newly connected data ports in node.add/update.
- [x] Verify flow/unchanged links and multiple producers preserve rejection semantics.

## Task 2: Runtime and historical result integrity
Files: front/js/ovllPointerLocal.js, ovllPointerResults.mjs and dedicated runtime regressions.
- [x] Red tests for empty outputs, wrong actual representations, empty exports and missing predecessor evidence.
- [x] Validate real values and preserve branch skip evidence; validate graph parents.
- [x] Distinguish enduring Task objective/constraints from follow-up request/history in result identity.
- [x] Verify connected export plus independent actual-content export.

## Task 3: Structured artifact handoff
Files: front/js/ovllPointerLocalActions.js, app.js and delivery regressions.
Interface: presentation({facts,messages,runs}) returns {text,artifacts}; app forwards artifacts to addAssistantMessage.
- [x] Red tests for confirmed file metadata, deduplication, stale suppression and ordinary text.
- [x] Implement structured presentation without generated Markdown artifact paths.
- [x] Exercise prompt, saved-function and canvas entry paths through real app functions.

## Task 4: Coordinator evidence and completion
Files: front/js/ovllPointerLocalActions.js, backend/ovllPointer/modelContract.js, instructions/prompts and regressions.
- [x] Red tests for undiscoverable prior result refs and unsupported actionless completion phrasings.
- [x] Supply a bounded latest-result index with verified currentness and explicit read refs.
- [x] Ground completion handling in actual action results; keep normal informational replies.
- [x] Clarify data links versus literals/flow and existing-result export in model guidance.

## Final integration
- [x] Whole npm test, changed syntax, diff check and independent review.
- [x] Document confirmed code causes separately from unavailable incident records.
- [ ] Commit/publish once, verify main and relevant CI.
