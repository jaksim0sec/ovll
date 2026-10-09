# OvllPointer Quality Implementation Plan

> For agentic workers: use superpowers:executing-plans task-by-task. The user authorized implementation and one final main commit.

Goal: restore useful end-to-end work, reusable definitions and clear grounded communication.
Architecture: retain the existing logical layers and browser-owned state. Share canonical catalog, instance input, output normalization and factual action results across model, canvas and local execution.
Tech Stack: current ESM Node/Express, Ajv, browser JavaScript, node:test; no new production dependencies.
Spec: docs/superpowers/specs/2026-10-09-pointer-quality-design.md

## Global Constraints
- main; preserve existing conversation/canvas behavior and storage keys.
- Dynamic definitions and user-custom work remain first-class.
- One final commit; APP_VERSION increment once.
- Current baseline 358/370; report unchanged failures explicitly.

## Review Focus
- Old snapshots lacking catalog/presentation/instance requests remain readable.
- Failed action dependencies and unresolved refs never produce a fake success.
- Material instructions do not become execution permission.
- Saved replay binds new inputs and retains its purpose/invariants.
- Truncation, blocked work and unsupported tools remain visible.

## Task 1: Catalog and definitions
Files: backend/ovllPointer/nodeCatalog.js, localHost.js, localHttp.js; front/js/ovllPointerApi.js, ovllPointerLocal.js, ovllPointerGraphPatch.js, ovllPointerProjection.js; graph core and contract schema.
Interfaces: getPointerCatalog() -> {definitions,presentations,capabilities}; snapshot definitions use stable builtin IDs/version; instance settings.request contains scoped work; presentation contains existing iconKey/name/color.
- [x] Add failing catalog/context, builtin canvas, request-isolation and presentation tests.
- [x] Verify failures, implement derived catalog and portable snapshot seeding/adaptation.
- [x] Run catalog/graph/projection/local host tests.

## Task 2: Execution and values
Files: localHost.js, nodeOutput.js, front/js/ovllPointerLocal.js and ovllPointerPlanCore.mjs; existing file/artifact integration.
Interfaces: local node execution gets task purpose and instance request; normalized outputs contain inline values and provenance; declared tool adapters consume exact bindings; exclusive branch capability gates routing.
- [x] Add failing button/ref/tool/branch/cancellation regressions.
- [x] Implement purpose fallback, input/output normalization, supported adapters and conditional skipping.
- [x] Verify local runtime and existing execution planner behavior.

## Task 3: Coordination and function replay
Files: front/js/app.js, ovllPointerLocalActions.js, ovllPointerFunctions.js, localHost.js; contract action schema.
Interfaces: factual action results, bounded needs follow-up, safe-boundary blocked-run adaptation; function.run resolves an existing saved draft and binds named new inputs.
- [x] Add failing dependency/status/context/function input regressions.
- [x] Implement shared coordinator and wire the application; retain direct user commands.
- [x] Verify proposal→patch→run→saved replay with model provider boundary stubbed only.

## Task 4: Full results and prompts
Files: instructions/prompts/**, instructions/registry.json, promptComposer.js, turnController.js, app.js; instruction documentation.
Interfaces: prompt data distinguishes node execution from previous proposal/action facts; full target outputs are the deliverable; ordinary chat remains one model call.
- [x] Add failing prompt-context/result-preservation tests and behavior coverage checks.
- [x] Rewrite concise modules, centralized wire guidance and factual capability language.
- [x] Validate module assembly, node-only output boundary and complete-result delivery.

## Task 5: Review and single commit
Files: server.js, architecture/instruction README and verification notes.
- [x] Run syntax, schema fixtures and complete npm tests; compare baseline failure names (190/190 related, 389/401 full; identical 12 baseline failures; 51 contract probes).
- [x] Fresh-context code review; fix important findings with RED→GREEN regressions (control port collisions and legacy function input mapping).
- [x] Increment APP_VERSION to 2026.10.09.36; verify complete diff and unchanged remote main.
- Final delivery: publish this verified change set in one atomic main commit, then inspect its ref and available CI; the commit/ref is the delivery record.
