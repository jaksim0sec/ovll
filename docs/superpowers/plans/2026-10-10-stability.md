# Ovll Stability Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and superpowers:dispatching-parallel-agents for the independent domains below. Each domain supplies regression evidence; the primary agent integrates and reviews the whole change before one commit.

**Goal:** Preserve task intent and trustworthy reusable results while extending function appearance and restoring mascot execution reactions.

**Architecture:** Keep the existing logical layers and active local runtime. Repair ownership and contracts at their boundaries; keep provider validation and side-effect authority separate from model proposals.

**Tech Stack:** Existing browser JavaScript/ES modules, Node.js, Express, Ajv, localStorage/IndexedDB and node:test. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-10-stability-design.md`

## Global Constraints

- Main baseline: `6d10cec765c5269307d501f146aa07463d2b31c7`; inspect latest origin/main before final commit.
- Preserve entry, four behavior layers, response, and dynamic definitions.
- No live AI calls or paid probes. Use fixed outputs and injected provider transports.
- No new branch/PR; one final verified commit; raise `APP_VERSION` in `server.js`.
- Preserve current UI language, colors, existing SVG paths and reduced-motion behavior.
- Do not turn unsupported capabilities into declared success.

## Review Focus

1. Late results after conversation change/destroy must never affect a different conversation.
2. Metadata-only files and output truncation must not appear as full successful reading/export.
3. Dynamic flow ports and canvas round trips must preserve logical edges.
4. Reused functions must not retain unrelated sample input or lose the original purpose/invariants.
5. Cancellation while queued, storage quota and concurrent writes must be explicit rather than silent loss.

## Task 1: Model context and phase contracts

**Files:** `backend/ovllPointer/{localHost,promptComposer,validation,modelContract,providers,geminiAdapter,configuredProvider}.js`, `instructions/`, relevant host/provider tests. The HTTP route is owned by Task 5.

**Interfaces:** Host operations accept optional `taskContext:{objective,requestText,constraints,historyDigest}`. Outputs remain backward-compatible ModelTurn/NodeOutput and may add `_meta` usage/actual provider/model/repair/fallback data, which must be separated before domain validation. Existing action schemas remain canonical.

- [x] Add failing behavior cases for original constraints, compact relevant definitions, phase-specific output schema/repair and usage.
- [x] Run related offline tests and observe the missing behavior.
- [x] Implement bounded context assembly, provider wire-schema projection and focused instructions without an extra routing model.
- [x] Run relevant host/composer/provider/behavior tests and report exact results.

## Task 2: Shared graph and projection semantics

**Files:** `front/js/ovllPointer{GraphCore,PlanCore,PortTypes}.mjs`, `ovllPointer{Projection,GraphPatch}.js`, `backend/ovllPointer/executionPlan.js`; graph/projection/plan tests.

**Interfaces:** Preserve canonical graph shape. UI projection retains logical endpoint mapping, link ID and kind. Provide a pure exported helper for node semantic fingerprints/current-run validity, or document the exact compatible interface for Task 4.

- [x] Write round-trip and invalid/multiple-flow/data producer behavior tests.
- [x] Observe failure; unify flow validation and reversible UI mapping.
- [x] Separate semantic result identity from graph revision/run epoch in fingerprints.
- [x] Run related plan/graph/projection tests and report public helper signatures.

## Task 3: Function contracts and appearance

**Files:** `front/js/ovllPointerFunctions.js`, `functionWorkspace.js`, `front/css/customNode.css`, `backend/ovllPointer/nodeCatalog.js`; function/icon tests.

**Interfaces:** `save` supports optional `baseFunctionRef:{id,version}` for immutable revision. `get(id,version?)` supports pinned lookup, `list()` returns current functions; preserve purpose/invariants when editing. Presentation remains `{name,description,color,iconKey,view}` using server-owned icons and normalized HEX.

- [x] Reproduce full-graph capture, stale sample binding, edit-as-new-ID and palette-only failures.
- [x] Extract target dependency closure and canonical input contract; preserve fixed values explicitly.
- [x] Implement versions and complete discovery data without changing the minimal node-authoring UX.
- [x] Add direct color picker/HEX input and searchable expanded server SVG catalog, retaining existing paths.
- [x] Verify persistence/reload/version/bind behavior with real store and UI harness where practical.

## Task 4: Local run, sources, delivery and storage

**Files:** `front/js/{ovllPointerLocal,ovllPointerLocalActions,fileStore,workspaceStore}.js`; local-run/actions/storage/source tests.

**Interfaces:** Existing `run({...})` shape remains; accept taskContext and return run snapshot/provenance/output validity metadata. File reading uses injected or global FileStore actual bytes. Expose deterministic current-result validation to the app. Keep `coordinate` bounded; questions use a stored checkpoint instead of inventing resumed execution.

- [x] Add failing cases for missing file bytes, stale result, source truncation, target/deliverable mismatch, cancelled pending nodes and durable artifact capture.
- [x] Implement actual text reading and structured availability/coverage; unsupported parsing remains blocked.
- [x] Record result fingerprints and execution/usage metadata; normalize final node states and choose intended deliverables.
- [x] Preserve necessary outputs for bounded follow-up, persist question state and separate apply facts from projection failures.
- [x] Reduce whole-state progress writes, detect cross-tab stale revision, expose recoverable storage failures.
- [x] Verify the relevant local-run/actions/storage cases offline; describe remaining browser durability limits accurately.

## Task 5: HTTP admission and artifacts

**Files:** `backend/ovllPointer/localHttp.js`, `backend/artifacts/{artifactStore,artifactDocument,pdfRenderer}.js`; HTTP/artifact tests. Primary agent alone changes `server.js` to mount new guards and bump version.

**Interfaces:** Reserve HTTP budget before queueing; signal/deadline covers queue wait. Artifact creation returns existing `artifact` with added truncation/availability metadata. Export guard/mount configuration for the primary agent; do not change server.js concurrently.

- [x] Observe budget lost updates and cancelled queued calls with injected host.
- [x] Implement reservation, cleanup and admission/queue deadlines; retain existing free-provider serialization.
- [x] Observe row/column/content truncation and unbounded artifact allocation.
- [x] Report omissions; bound generated bytes/count/concurrency and clean up failures.
- [x] Run HTTP/artifact offline tests and provide server integration instructions.

## Task 6: App ownership, mascot and final integration

**Files:** Primary agent owns `front/js/app.js`, `mascot.js`, `workspacePresence.js`, `boot.js`, `front/sw.js`, `server.js`, active architecture/status docs and corresponding tests.

- [x] Reproduce missing new-path workAtNode events and late-response ownership with existing harness/fixed runs.
- [x] Capture owner/generation for each operation; share busy/cancel lifecycle and retain Task context across turns.
- [x] Integrate current-result validation, function versions/all-function index, sources, metadata and artifact availability from Tasks 1–5.
- [x] Bridge live node transitions to working/success/error/cancel mascot behavior exactly once per transition. Historical restoration never triggers it.
- [x] Preserve active working state when chat thinking/settling changes and stop stale gaze callbacks from overriding current work.
- [x] Align shell precache with boot assets, localized status and full-result inspection.
- [x] Update implementation/limitation docs and APP_VERSION; run the complete offline suite once after focused checks pass.
- [x] Obtain a fresh whole-change review, fix material findings, then create one final commit after checking current origin/main.

## Execution record

Track task progress and decisions outside tracked product source. The existing report is the basis, while code and fresh regression evidence decide correctness. Do not claim live model quality or visual jitter is proven by node:test.

최종 검증과 알려진 제한은 `docs/architecture/STABILITY_2026-10-10.md`에 기록한다. 실시간 모델·브라우저 시각·PostgreSQL 통합 검증 완료로 해석하지 않는다. 사용자의 main/단일 커밋 요청에 따라 새 브랜치·PR·선택 메뉴는 만들지 않는다.
