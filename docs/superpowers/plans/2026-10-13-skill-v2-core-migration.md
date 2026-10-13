# Skill v2 Core Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Rename Ovll's domain concept of Node to Skill across storage, graph runtime, APIs, filenames, prompts and product UI without changing execution semantics or losing any legacy user data.

**Architecture:** Introduce a single pure Skill v2 codec, migrate browser and server ingress to it, then move graph/runtime/public interfaces onto the canonical Skill schema. Legacy Node shapes are accepted only by explicit versioned adapters; original localStorage data and existing evidence remain recoverable. This plan delivers independently usable Skill v2 software, and must finish before the reference/rendering plan.

**Tech Stack:** JavaScript ESM (Node.js, browser dynamic import), existing classic browser scripts, Express, Ajv, localStorage, PWA asset manifest, CSS, node:test.

**Spec:** docs/superpowers/specs/2026-10-13-skill-contract-migration-design.md

**Next plan:** docs/superpowers/plans/2026-10-13-skill-reference-protocol-and-ui.md. Do not implement its message-chip or language-output features in this plan.

## Global Constraints

- Canonical persisted/public fields: skills, skillId, skillDefinitionRef, skillDefinitions. A definition retains definitionId and version; link/graph IDs and port names remain byte-identical.
- Canonical action names: skill.define, skill.add, skill.update, skill.delete, skill.revise, skill.appearance, skill.definition.delete. Non-Skill link, run, function and Task semantics are unchanged.
- Legacy nodes, nodeId, definitionRef, definitions and legacy action strings are accepted only by named inbound adapters; contradictory mixed shapes are errors.
- Existing IDs are **not rewritten**, including old n_ prefixes. Graph revision, connections, settings, definition versions, function bindings and scheduling semantics are preserved.
- Existing storage key ovll:workspace:v1 must stay readable and unmodified. Use new key ovll:workspace:skill:v2 with schemaVersion 10 for canonical writes; preserve old key as fallback. Do not silently overwrite failed conversions.
- Keep the existing user-defined Skill plugin and function storage; functions are not renamed to skills or redesigned.
- No new dependency, model provider or model call; no changing SVG paths, canvas gestures, scheduler behavior, prompt budgets or Android input/keyboard layout.
- Rename domain-specific filenames and identifiers, but never rename Node.js modules, DOM Node/nodeType/NodeList, historical archives, or explicit legacy adapters.
- Never commit or merge implementation to main without explicit authorization. Run baseline and tests in an isolated worktree; if baseline fails, stop and report.
- Every task: test RED, minimal implementation GREEN, targeted regression suite GREEN, focused commit. Do not claim live Render/Vercel/model/device verification without running it.

## Review Focus

1. **Mixed old/new snapshots:** graph contains both nodes and skills at nested levels; the codec must reject rather than choose. Covered in Task 1 test.
2. **localStorage quota or crash mid-migration:** old key remains untouched, new key is either complete and verified or ignored. Covered in Task 2 test.
3. **Same graph/Skill ID across conversations:** graph and conversation scope still prevent cross-conversation mutations. Covered in Task 3 test.
4. **Legacy result fingerprint with changed inputs:** old evidence must not become valid merely because its fields were renamed. Covered in Task 6 test.
5. **Old PWA and server at different deployments:** old HTTP routes accept old ingress while new routes emit new schema; failed/unsupported combinations reject without side effects. Covered in Task 5 test.

---

## Scope map

- **Canonical codec (new):** front/js/ovllSkillCodec.mjs. Pure conversion, validation and mapping logic shared by server ESM and browser; no storage or rendering responsibility. Browser load explicitly before existing classic scripts in front/js/boot.js.
- **Persistence:** front/js/workspaceStore.js; canonical key, import/export, canvas drafts, Pointer graph, Run snapshots and function references.
- **Graph authority:** front/js/ovllPointerGraphCore.mjs, ovllPointerGraphPatch.js, ovllPointerProjection.js, ovllPointerPlanCore.mjs and backend/ovllPointer/graph.js.
- **Execution and evidence:** backend/ovllPointer/lifecycle.js, actions.js, actionCompiler.js, executionPlan.js, modelExecutor.js, nodeExecution.js, nodeOutput.js, modelContract.js, turnNormalizer.js, localHost.js; front/js/ovllPointerResults.mjs, ovllPointerLocal.js, ovllPointerLocalActions.js, ovllPointerFunctions.js, ovllPointerActivity.js.
- **User-facing creation:** front/js/canvasNode.js, canvasNodeBuilder.js, customNodes.js, customNodeStore.js, app.js, ovllWorkspace.js, libraryPage.js, mascot.js; front/css/node.css and selectors in front/css/ui.css; tests.
- **Server catalog and routes:** backend/ovllPointer/nodeCatalog.js, localHttp.js, runtime.js, validation.js, promptComposer.js, server.js and front/js/ovllPointerApi.js.
- **Load/deployment:** front/asset-manifest.js, front/index.html, front/sw.js, relevant boot/runtime and tests; legacy URLs continue to be handled at the boundary.
- **Prompt language:** instructions/prompts/core.md, layers/*.md, micro/ir/*.md, micro/run/*.md, instructions/README.md and backend/ovllPointer/modelContract.js. Full reference protocol is reserved for the second plan.

## Task 1: Pure canonical Skill graph codec and field/version contract

**Files:**
- Create: front/js/ovllSkillCodec.mjs
- Create: test/ovllSkillCodec.test.js
- Inspect: front/js/ovllPointerGraphCore.mjs; backend/ovllPointer/validation.js; test/ovllPointerMigration.test.js

**Interfaces:**
- Produces: normalizeSkillSnapshot(value,{source='auto'}={}) -> deep-cloned canonical SkillGraphSnapshot.
- Produces: normalizeSkillPatch(value,{source='auto'}={}) and normalizeSkillRun(value,{source='auto'}={}) -> canonical structures.
- Produces: assertCanonicalSkillSnapshot(value) -> true or throws SkillSchemaError(code,path).
- Canonical fields: graph.skills[].skillId, graph.skills[].skillDefinitionRef; graph.connections[].from.skillId and .to.skillId; top-level skillDefinitions.
- Legacy ingress fields: graph.nodes[].nodeId, .definitionRef; graph.connections endpoints nodeId; top-level definitions. No silent mixed-field precedence.

- [ ] **Step 1: RED test.** In test/ovllSkillCodec.test.js import the three conversion functions. Assert old IDs, graph revision, connections/ports, nested inputBindings, definition versions and source object are preserved; assert canonical input is idempotent. Assert mixed snapshots and inconsistent aliases throw SkillSchemaError with a path.
- [ ] **Step 2: Run.** node --test test/ovllSkillCodec.test.js. Expected: FAIL from missing module/exports, not accidental baseline errors.
- [ ] **Step 3: Implement.** Make the exact functions above pure and fail closed. Do not alter runtime Graph semantics. Rule: canonical new objects pass through deep clone; legacy conversion renames only schema keys, recursively at documented graph/Patch/Run fields (never arbitrary user settings or artifact content).
- [ ] **Step 4: Verify.** node --test test/ovllSkillCodec.test.js. Expected: all PASS; add asserts for unrecognized field and oversized snapshot rejection at the same validator limits as existing code.
- [ ] **Step 5: Commit.** git add front/js/ovllSkillCodec.mjs test/ovllSkillCodec.test.js && git commit -m "feat(skill): define canonical v2 codec and legacy snapshot conversions"

## Task 2: Persistent migration with original-key preservation

**Files:**
- Modify: front/js/workspaceStore.js (STORAGE_KEY, normalization, import/export, Pointer definitions and Run getters)
- Modify: front/js/boot.js; front/asset-manifest.js
- Create: test/ovllSkillStorageMigration.test.js
- Update: test/ovllPointerMigration.test.js, test/ovllPointerLocalStorage.test.js

**Interfaces:**
- Consumes: normalizeSkillSnapshot, normalizeSkillRun from Task 1.
- Produces: OvllWorkspaceStore.schemaVersion === 10; OvllWorkspaceStore.storageKey === 'ovll:workspace:skill:v2'.
- Produces: existing store methods adapted to Skill naming (getSkillDefinitions/getSkillOutput and updateConversationSkillGraph/SkillRuns); **legacy persisted inputs only** decoded from old key.

- [ ] **Step 1: RED tests.** VM localStorage fixture containing ovll:workspace:v1 with a graph, canvas, Run, uploaded file metadata and saved function. Assert boot picks valid new v2 when present, else converts old; successful write does not mutate old; quota throw leaves old readable; failed/partial v2 record falls back only after validating old; import/export is idempotent and canonical.
- [ ] **Step 2: Run.** node --test test/ovllSkillStorageMigration.test.js. Expected: FAIL (new API/key absent).
- [ ] **Step 3: Implement.** Before classic scripts load, front/js/boot.js dynamically imports the relative ovllSkillCodec.mjs once and exposes window.OvllSkillCodec. Add the module to asset-manifest modules/precache and test offline boot. In workspaceStore use this synchronous initialized codec. Write to new key only after validation; keep old key intact. A missing codec is a clear initialization error, not silent data reset.
- [ ] **Step 4: Verify.** node --test test/ovllSkillStorageMigration.test.js test/ovllPointerMigration.test.js test/ovllPointerLocalStorage.test.js test/offlineAssetCoverage.test.js. Expected: PASS; update isolated VM test harnesses to load codec explicitly.
- [ ] **Step 5: Commit.** git commit -am "feat(skill): preserve legacy workspace while persisting canonical skill state" (include new test file explicitly).

## Task 3: Graph authority and patch projection conversion

**Files:**
- Modify: front/js/ovllPointerGraphCore.mjs, front/js/ovllPointerGraphPatch.js, front/js/ovllPointerProjection.js, front/js/ovllPointerPlanCore.mjs
- Modify: backend/ovllPointer/graph.js; backend/ovllPointer/validation.js
- Test: test/ovllSkillGraphKernel.test.js (new); test/ovllPointerGraphPatchBindings.test.js; test/ovllPointerProjection.test.js; test/ovllPointerDefinitionDeletion.test.js

**Interfaces:**
- Consumes: canonical SkillGraphSnapshot and SkillPatch Task 1.
- Produces: computeSkillScope(graph, targets, mode='closed'), MemoryGraphRepository with canonical Skill snapshot.
- Produces: frontend patch planner using skill.add/update/delete with skillId, localSkillKey and SkillSelector; preserve link port and DAM ordering.
- Legacy input normalization exists only at repository/HTTP import boundary, not in graph algorithms.

- [ ] **Step 1: RED tests.** Assert creating/linking/editing/deleting canonical skills preserves graph revision, link ordering, port names, expectedGraphRevision checks and cross-conversation scope; test two same skillId in distinct graph scopes cannot cross-update. Assert nested nodeId is rejected after normalization.
- [ ] **Step 2: Run.** node --test test/ovllSkillGraphKernel.test.js. Expected: FAIL.
- [ ] **Step 3: Implement.** Rename domain types/functions/fields in kernel and browser projection/patch. Update imports in all direct callers; do not revise schedulers or algorithms. Add one intentional compatibility entry in backend/ovllPointer/graph.js if existing external callers need it, with explicit legacy-only name.
- [ ] **Step 4: Verify.** node --test test/ovllSkillGraphKernel.test.js test/ovllPointerGraphPatchBindings.test.js test/ovllPointerProjection.test.js test/ovllPointerDefinitionDeletion.test.js. Expected: PASS.
- [ ] **Step 5: Commit.** git commit -am "refactor(skill): move graph kernel and patches to Skill v2"

## Task 4: Browser projection, canvas and function bindings

**Files:**
- Modify: front/js/ovllPointerLocal.js, ovllPointerLocalActions.js, ovllPointerFunctions.js, app.js, ovllWorkspace.js, ovllPointerActivity.js
- Modify: front/js/canvasNode.js, canvasNodeBuilder.js, customNodes.js, customNodeStore.js, libraryPage.js
- Test: test/ovllSkillCanvasMigration.test.js (new); test/ovllPointerMigration.test.js; test/ovllPointerSharedDefinitions.test.js; test/customNodes.test.js; test/ovllPointerLocalRun.test.js

**Interfaces:**
- Consumes: canonical SkillSnapshot, computeSkillScope, SkillPatch.
- Produces: browser model whose Canvas workflow contains skills, whose creation callbacks return skillId and whose per-conversation definitions use skillDefinitions.
- Existing saved function IDs, bound input names, outputMap, artifact data, canvas geometry and user-created Skill types are unchanged.

- [ ] **Step 1: RED tests.** Import legacy workflow.nodes and convert canvas.workflow.skills with same x/y/ports/link identities. Add custom Skill via palette; open a different conversation with same Skill ID and assert isolation; bind a saved function and assert inputs/outputs unchanged.
- [ ] **Step 2: Run.** node --test test/ovllSkillCanvasMigration.test.js. Expected: FAIL.
- [ ] **Step 3: Implement.** Rewrite browser-facing domain selectors, events, methods and saved draft projection to Skill structures; retain legacy display-data converter only at old stored-data boundary. Preserve existing mobile composer/editor geometry, canvas node-drag gestures and custom plugin registration behavior.
- [ ] **Step 4: Verify.** node --test test/ovllSkillCanvasMigration.test.js test/ovllPointerMigration.test.js test/ovllPointerSharedDefinitions.test.js test/customNodes.test.js test/ovllPointerLocalRun.test.js. Expected: PASS.
- [ ] **Step 5: Commit.** git commit -am "refactor(skill): convert canvas and function bindings without altering behavior"

## Task 5: Server action language, model contract and versioned routes

**Files:**
- Modify: backend/ovllPointer/actionCompiler.js, modelContract.js, turnNormalizer.js, localHost.js, localHttp.js, promptComposer.js
- Modify: front/js/ovllPointerApi.js; backend/ovllPointer/validation.js
- New: backend/ovllPointer/skillIngress.js
- Test: test/ovllSkillActionContract.test.js (new); test/ovllPointerActionCompiler.test.js; test/ovllPointerLocalHost.test.js; test/ovllPointerModelContract.test.js; test/apiExecution.test.js

**Interfaces:**
- Consumes: normalized canonical Skill snapshot and patch.
- Produces: ACTION_PLAN_CONTRACT='action-plan.v2' for new models; old v1 accepts only via skillIngress. Canonical semantic actions skill.define/add/update/delete/revise/appearance/definition.delete.
- Produces: POST /api/pointer/local/skill, preserving legacy /api/pointer/local/node as a narrow input alias; catalog endpoint stays at /api/pointer/local/catalog.
- Produces: adaptLegacySkillRequest(value,{routeVersion}) and adaptLegacySkillActionPlan(value) -> canonical or deterministic validation error. Existing authorization and phase budgets stay the same.

- [ ] **Step 1: RED tests.** Feed old action-plan.v1, IR node.add and old /node request through adapter; ensure accepted only in legacy mode. New /skill route rejects Node-shaped input, emits canonical Skill response; old route does not mutate storage or silently upgrade unknown actions. Test denied authorization, bad port and mixed shapes still fail before side effects.
- [ ] **Step 2: Run.** node --test test/ovllSkillActionContract.test.js. Expected: FAIL.
- [ ] **Step 3: Implement.** Centralize legacy translation in skillIngress; switch compiler/schema/prompts to v2 strings. Keep semantic action field lists and runtime approval checks unchanged. Update local host/HTTP/front API together; old route is compatibility-only and must never be advertised to new clients.
- [ ] **Step 4: Verify.** node --test test/ovllSkillActionContract.test.js test/ovllPointerActionCompiler.test.js test/ovllPointerLocalHost.test.js test/ovllPointerModelContract.test.js test/apiExecution.test.js. Expected: PASS.
- [ ] **Step 5: Commit.** git add backend/ovllPointer/skillIngress.js test/ovllSkillActionContract.test.js && git commit -am "feat(skill): version action wire contract and preserve legacy ingress"

## Task 6: Run execution, output validation and legacy result evidence

**Files:**
- Modify: backend/ovllPointer/nodeExecution.js, nodeOutput.js, executionPlan.js, modelExecutor.js, lifecycle.js, actions.js, runtime.js, localHost.js
- Modify: front/js/ovllPointerResults.mjs, ovllPointerPlanCore.mjs, ovllPointerLocal.js, ovllPointerFunctions.js
- Create: test/ovllSkillEvidenceCompatibility.test.js
- Test: test/ovllPointerExecutionIntegrity.test.js; test/ovllPointerLocalRun.test.js; test/ovllPointerNodeOutput.test.js; test/ovllPointerFunctionBuilder.test.js

**Interfaces:**
- Consumes: canonical Skill execution targets and snapshot; preserves existing ports, ordering and semantics.
- Produces: skillSemanticFingerprint(snapshot,skillId,options), isCurrentSkillResult(snapshot,skillId,result,options).
- Legacy evidence: only original Node semantic serialization with matching original source context can validate a legacy fingerprint. Must not recalculate old hashes from renamed fields and call them equal.

- [ ] **Step 1: RED tests.** Fixture precomputed legacy Node semantic digests (record literal values before implementation). Verify intact original context accepted only by legacy verifier; changed bindings/graph/definition/version rejected; new Skill digest accepted only for Skill records. Assert no duplicate execution of a previously valid result.
- [ ] **Step 2: Run.** node --test test/ovllSkillEvidenceCompatibility.test.js. Expected: FAIL.
- [ ] **Step 3: Implement.** Preserve a narrow read-only legacy evidence verifier, isolate its original field names and stable serialization; rewrite active execution/output/Run field names. Never modify outputPort schema, evidence trust, DAM policy or workflow scheduler.
- [ ] **Step 4: Verify.** node --test test/ovllSkillEvidenceCompatibility.test.js test/ovllPointerExecutionIntegrity.test.js test/ovllPointerLocalRun.test.js test/ovllPointerNodeOutput.test.js test/ovllPointerFunctionBuilder.test.js. Expected: PASS.
- [ ] **Step 5: Commit.** git commit -am "refactor(skill): retain exact legacy evidence verification under Skill execution"

## Task 7: Domain filename moves, loaders, imports and CSS selectors

**Files:**
- Rename: front/js/canvasNode.js -> front/js/canvasSkill.js
- Rename: front/js/canvasNodeBuilder.js -> front/js/canvasSkillBuilder.js
- Rename: front/js/customNodes.js -> front/js/customSkills.js
- Rename: front/js/customNodeStore.js -> front/js/customSkillStore.js
- Rename: front/css/node.css -> front/css/skill.css
- Rename: backend/ovllPointer/nodeCatalog.js -> backend/ovllPointer/skillCatalog.js
- Rename: backend/ovllPointer/nodeExecution.js -> backend/ovllPointer/skillExecution.js
- Rename: backend/ovllPointer/nodeOutput.js -> backend/ovllPointer/skillOutput.js
- Modify: front/asset-manifest.js, front/index.html, front/js/boot.js, front/sw.js; server.js; all imports/callers to moved paths (including test fixtures)
- Test: test/ovllSkillAssetContract.test.js (new); test/offlineAssetCoverage.test.js; test/node-icon-authority.test.js

**Interfaces:**
- Produces: stable canonical Skill-named asset URLs, class names and import paths; only explicit legacy adapter/test fixtures retain Node names.
- Browser asset order and current .svg-icon/style sizing remains unchanged.

- [ ] **Step 1: RED tests.** Assert all new paths load and old production asset paths are absent from the canonical manifest; every stylesheet link points to existing CSS; all import specifiers resolve; node-derived DOM selectors become skill names; service worker precache matches.
- [ ] **Step 2: Run.** node --test test/ovllSkillAssetContract.test.js. Expected: FAIL.
- [ ] **Step 3: Implement.** git mv files listed above, then update all references and CSS/JS selectors as one atomic task. Inventory other domain-specific filenames with git ls-files | grep -Ei '(node|Node)' and include justified additional moves in this commit. Do not rename DOM/Node.js APIs, immutable backend input port names or historical archive paths.
- [ ] **Step 4: Verify.** node --test test/ovllSkillAssetContract.test.js test/offlineAssetCoverage.test.js test/node-icon-authority.test.js test/uiArchitecture.test.js. Expected: PASS.
- [ ] **Step 5: Commit.** git add -A && git commit -m "refactor(skill): rename domain assets and update import and cache references"

## Task 8: UI language, runtime events and prompt vocabulary

**Files:**
- Modify: front/js/app.js, canvasSkill.js, canvasSkillBuilder.js, ovllWorkspace.js, ovllPointerActivity.js, mascot.js, shellMenu.js, libraryPage.js
- Modify: front/css/skill.css, ui.css, chat.css (only selectors tied to renamed domain)
- Modify: instructions/prompts/core.md, instructions/prompts/layers/*.md, instructions/prompts/micro/ir/*.md, instructions/prompts/micro/run/*.md, instructions/README.md, backend/ovllPointer/modelContract.js
- Test: test/ovllSkillVocabulary.test.js (new); test/workspaceArchitecture.test.js; test/ovllPointerPromptComposer.test.js

**Interfaces:**
- Produces: user-visible '스킬', '스킬 추가', '캔버스 스킬' in current surfaces; Skill semantic names in current prompt instructions and runtime event presentation.
- Accepts deprecated Korean '노드' only as an optional **hidden input synonym** for existing user phrasing, without showing Node in new UI.

- [ ] **Step 1: RED tests.** Snapshot menu/palette/runtime labels; assert no user-facing Node naming in active current files; assert model prompt module registry still assembles and no field/path mismatch. Explicitly exempt Node.js, DOM, legacy input mappings, immutable user data and historical docs.
- [ ] **Step 2: Run.** node --test test/ovllSkillVocabulary.test.js. Expected: FAIL.
- [ ] **Step 3: Implement.** Rename terminology and domain event keys in these exact UI/prompt paths; increment prompt module versions when content changes; avoid changing model role responsibilities or adding calls. Update active docs (not archive) to Skill v2 schema.
- [ ] **Step 4: Verify.** node --test test/ovllSkillVocabulary.test.js test/workspaceArchitecture.test.js test/ovllPointerPromptComposer.test.js. Expected: PASS.
- [ ] **Step 5: Commit.** git commit -am "style(skill): replace active node vocabulary and preserve prompt responsibilities"

## Task 9: Final contract sweeps, old-data fixtures and integration gate

**Files:**
- Create: test/ovllSkillEndToEnd.test.js
- Modify only as required by proved regressions: previously touched files from Tasks 1–8
- Update: backend/ovllPointer/README.md, instructions/README.md with actual migrated contract, legacy ingress exception inventory

**Interfaces:**
- Produces: audited Skill v2 path from stored graph to canvas to local API to runtime result, with no legacy fields after ingress.
- Input exception inventory: docs/architecture/SKILL_LEGACY_EXCEPTIONS.md (create).

- [ ] **Step 1: RED integration test.** Start from real legacy WorkspaceStore fixture, migrate to Skill v2, edit canvas and run one deterministic injected model/executor, validate outputs, close/reopen/export/import, and confirm IDs, graph revision, action counts, results and files match.
- [ ] **Step 2: Run.** node --test test/ovllSkillEndToEnd.test.js. Expected: FAIL until remaining integration edges are corrected.
- [ ] **Step 3: Implement.** Fix only contract-mismatch failures and document remaining allowed Node terms, including Node.js, DOM, historical documents, old ingress adapters and old fingerprints. No broad string replacements.
- [ ] **Step 4: Verify.** npm test and node --test test/ovllSkillEndToEnd.test.js. Expected: all PASS. If baseline previously failed for unrelated reasons, report and stop; do not edit unrelated code to green the suite. Separately verify Render /api/version and front deployment only if staging credentials exist.
- [ ] **Step 5: Commit.** git add -A && git commit -m "test(skill): verify end-to-end migration and document compatibility exceptions"

## Pre-flight order, rollback and done definition

- Verify repository baseline: git status --short, git log -1 --oneline, npm test, git ls-files inventory and grep contracts. Record the exact starting SHA before Task 1.
- Run tasks 1 -> 9 in order; do not independently cherry-pick tasks 3–8. On any failure stop the affected task; do not mutate legacy storage or merge partially.
- For test fixture paths referring to renamed modules, update fixtures as part of the corresponding task; never delete runtime coverage because a filename changed.
- The only allowed fallback under migration failure is **read-only use of intact legacy data**, with a clear error. No automatic destructive recovery.
- Done for plan A: canonical Skill v2 works independently, all former Node concepts are renamed except audited compatibility/non-domain exceptions, complete npm test suite passes and legacy saved work remains intact.
- Next: execute the Skill Reference Protocol and UI plan, then run a whole-branch review before any release/merge.
