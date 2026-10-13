# Skill Reference Protocol and Unified UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make Skill definitions, canvas Skill instances and saved functions round-trip as stable references across the composer, user bubbles, AI replies and language prompts, with a single verified token grammar and shared visual chips.

**Architecture:** A pure reference codec produces structured, versioned SkillReference parts; a scope-aware resolver verifies those parts against current Skill v2 registries; one DOM renderer paints valid references in all message surfaces. A single prompt instruction module teaches existing models the same grammar and is included in direct and EXIT paths without additional model calls.

**Tech Stack:** ES modules for pure codec, existing classic browser JS and CSS, backend prompt registry and Pointer local host, node:test, existing SVG catalog and .svg-icon style.

**Spec:** docs/superpowers/specs/2026-10-13-skill-contract-migration-design.md

**Depends on:** docs/superpowers/plans/2026-10-13-skill-v2-core-migration.md — all its tests must be green on this branch first.

## Global Constraints

- Use canonical Skill v2 fields skills, skillId, skillDefinitionRef, skillDefinitions, plus graphId for canvas instance identity. Stored functions remain a separate type.
- One versioned wire grammar: ⟦ovll:ref:v1:skill-def:ENCODED_ID[:VERSION]⟧, ⟦ovll:ref:v1:skill-canvas:ENCODED_GRAPH_ID:ENCODED_SKILL_ID⟧, ⟦ovll:ref:v1:function:ENCODED_ID[:VERSION]⟧.
- IDs use canonical uppercase-hex RFC3986 UTF-8 percent encoding; colon and delimiters inside IDs are encoded. Version if present is a positive decimal integer. Token length is bounded by 512 UTF-16 code units; decoded IDs are non-empty, <= 160 Unicode scalar values and have no control characters. Never infer a missing definition version if multiple versions match.
- Unresolved, unauthorized, cross-graph, spoofed or malformed tokens are plain inert text, never executable references. Model or pasted text cannot grant actions.
- Preserve raw message text, whitespace, search, copy, accessibility, old drafts and historical data. Store trusted structured parts separately from text.
- Same chip look, icon, semantics and .svg-icon styling in composer, user bubble and assistant response. Do not change input size, button positions, IME, focus or mobile viewport logic.
- Only the existing verified available Skill/Function registry may resolve tokens. Never fetch network data solely to decorate a chip or introduce new LLM calls.
- Product UI does not show obsolete Node terminology except original user-authored historical text.
- No new npm dependency; no changes to execution, scheduling, function bindings or API budgets.
- Implement on an isolated branch, task-by-task RED → GREEN → commit. Do not merge to main without explicit approval.

## Review Focus

1. **An actual user's literal token-shaped text:** should stay literal, not silently become a Skill chip. Covered Task 4.
2. **Names containing brackets, quotes or malicious HTML:** must display as escaped text and never execute markup. Covered Task 3.
3. **Removed or renamed Skill definitions:** existing chip retains identity without silently rebinding to a same-named item. Covered Task 2 and Task 5.
4. **AI half-finished token while message is arriving:** may show interim raw text; only completed and verified token renders as a chip. Covered Task 5.
5. **Model returns plausible ID outside accessible graph or changes conversation:** no chip, no execution privilege. Covered Task 6.

---

## Shared interfaces and file responsibilities

- Create front/js/ovllSkillReferences.mjs: only syntax, typed reference shape, deterministic serialization and raw-string segmentation. No registry, DOM or networking.
- Create front/js/skillReferenceResolver.js: factory consuming current Skill v2 definitions/canvas scope and stored function API, outputs resolved label/iconKey/color/kind, never mutates data.
- Create front/js/skillReferenceView.js: DOM-only read-only chip factory and renderer; no input focus or keyboard events.
- Create front/css/skillReferences.css: shared chip colors/icon sizing, preserving the existing .svg-icon/mention design.
- Modify front/js/ovllComposer.js (existing input editor), front/js/app.js and front/js/ovllWorkspace.js (existing message rendering), front/js/workspaceStore.js (trusted parts), front/asset-manifest.js, front/js/boot.js, front/index.html and front/css/composer.css (remove duplicated chip declarations only after comparing visuals).
- Add instructions/prompts/shared/skill-references.md to instructions/registry.json; update instructions/prompts/layers/response.md, instructions/prompts/layers/entry.md, instructions/prompts/layers/chat.md and backend/ovllPointer/modelContract.js, localHost.js, promptComposer.js.
- Legacy display part types node_type / node_instance and strings @label〔노드 타입:ID〕 are accepted only in old-draft compatibility parsing, never emitted by new writer.

### Task 1: Versioned SkillReference grammar and lossless segmentation

**Files:**
- Create: front/js/ovllSkillReferences.mjs
- Create: test/ovllSkillReferences.test.js
- Review: front/js/ovllSkillCodec.mjs (from core plan)

**Interfaces:**
- Produces: serializeSkillReference(ref) -> string; parseSkillReference(token) -> frozen typed reference or null.
- Produces: segmentSkillReferences(text) -> ordered array of {type:'text',text} and {type:'candidate',token,reference}; no resolution, no dropped separators.
- Produces: escapeSkillReferenceLiteral(text) -> text with unambiguous escaping, used only for plain user text adjacent to tags.
- Skill ref union: {kind:'skill-definition',definitionId,version?} | {kind:'skill-canvas',graphId,skillId} | {kind:'function',functionId,version?}.

- [ ] **Step 1: RED tests.** In test/ovllSkillReferences.test.js assert exact sample tokens, round-trip of colon/Unicode/percent/whitespace/control-char cases, repeated adjacent tokens, malformed percent escapes, invalid versions, 512-char limit and exact concatenation of segments to original input. Assert canonical re-serialization and no acceptance of double-encoded ambiguous IDs.
- [ ] **Step 2: Run.** node --test test/ovllSkillReferences.test.js. Expected: FAIL from missing module/exports.
- [ ] **Step 3: Implement.** Pure ESM codec with canonical encoding: encodeURIComponent plus RFC3986 encoding of ! ' ( ) *; uppercase percent escape hex. Parse by explicit prefix/kind and position, not ambiguous split on untrusted decoded characters. Literal escaping must be reversible and must not let pasted text gain trusted structured-part status.
- [ ] **Step 4: Verify.** node --test test/ovllSkillReferences.test.js. Expected: PASS, including fuzzed random text that must reconstruct byte-for-byte after segmenting.
- [ ] **Step 5: Commit.** git add front/js/ovllSkillReferences.mjs test/ovllSkillReferences.test.js && git commit -m "feat(skill): define typed canonical references and parser"

### Task 2: Scope-aware reference registry and no guessing

**Files:**
- Create: front/js/skillReferenceResolver.js
- Create: test/ovllSkillReferenceResolver.test.js
- Modify: front/js/boot.js; front/asset-manifest.js (load pure ESM codec and resolver before composer)
- Inspect: front/js/ovllWorkspace.js; front/js/ovllPointerFunctions.js; front/js/ovllSkillCodec.mjs

**Interfaces:**
- Consumes: SkillReference types from Task 1 and Skill v2 graph registry from core plan.
- Produces: createSkillReferenceResolver({getSkillDefinitions,getCanvasGraph,getFunctions,getCurrentScope}) -> {resolve(ref),allowedReferences()}.
- resolve returns null or {reference,kind,label,iconKey,color,scope,disabled:false}; never resolves a canvas ref when graphId !== getCurrentScope().graphId, even if skillId exists in another graph.
- Identity is definitionId+exact version, graphId+skillId or functionId+exact version; display names are not keys.

- [ ] **Step 1: RED tests.** Define duplicate labels/IDs in two graphs and versions. Assert correct instance and definition selection, custom Skill precedence does not affect identity, missing version with multiple matches returns null, deleted Skill returns null, spoofed graph ID returns null, unknown icons use existing fallback only.
- [ ] **Step 2: Run.** node --test test/ovllSkillReferenceResolver.test.js. Expected: FAIL.
- [ ] **Step 3: Implement.** Resolve only in-memory authorized scoped registries; never fetch asynchronously to decorate text or elevate privilege. Browser bootstrap loads codec once before classic scripts, then exposes a read-only reference API as window.OvllSkillReferences; load the resolver before input and message components.
- [ ] **Step 4: Verify.** node --test test/ovllSkillReferenceResolver.test.js test/offlineAssetCoverage.test.js. Expected: PASS. New asset included in manifest and precache, boot sequence intact.
- [ ] **Step 5: Commit.** git add -A && git commit -m "feat(skill): add scoped reference resolver and boot wiring"

### Task 3: One safe Skill chip renderer

**Files:**
- Create: front/js/skillReferenceView.js
- Create: front/css/skillReferences.css
- Create: test/ovllSkillReferenceView.test.js
- Modify: front/asset-manifest.js; front/index.html; front/css/composer.css (move shared chip rules only)
- Inspect: front/css/style.css; front/css/chat.css; front/js/svgLibrary.js

**Interfaces:**
- Produces: createSkillReferenceChip(document,resolved,{interactive=false}) -> HTMLElement using textContent, no unsanitized model HTML.
- Produces: renderSkillReferenceParts(container,parts,{resolve,mode='message'}) -> container; handles text/candidate/validated-reference parts and preserves exactly the user's line breaks.
- Uses CSS .ovll-skill-ref and .svg-icon; composer may wrap chip with editing events but read-only message chips must not focus input.

- [ ] **Step 1: RED tests.** Render text+Skill+text with missing resolver, hostile label containing angle brackets/quotes/script text, altered svg/icon key and a very long name. Assert text nodes are inert, chip accessibility label includes kind+name, icon is proportionate, no raw innerHTML interpolation of untrusted text, and final DOM text order matches original content.
- [ ] **Step 2: Run.** node --test test/ovllSkillReferenceView.test.js. Expected: FAIL.
- [ ] **Step 3: Implement.** Renderer builds nodes explicitly and reuses only trusted current server SVG/icon library under existing sanitizer authority. Shared CSS copies visual proportions from current composer tags without affecting .ovll-composer-rich form height or selection logic.
- [ ] **Step 4: Verify.** node --test test/ovllSkillReferenceView.test.js test/skill-visual-contract.test.js test/uiArchitecture.test.js. Expected: PASS; compare reference chip styling in light/dark.
- [ ] **Step 5: Commit.** git add front/js/skillReferenceView.js front/css/skillReferences.css front/css/composer.css front/index.html front/asset-manifest.js test/ovllSkillReferenceView.test.js && git commit -m "feat(skill): render trusted references as unified DOM chips"

### Task 4: Composer typed parts, old draft compatibility and submit

**Files:**
- Modify: front/js/ovllComposer.js, front/js/workspaceStore.js, front/js/app.js, front/js/ovllWorkspace.js
- Create: test/ovllSkillComposerRoundtrip.test.js
- Update: test/ovllSkillStorageMigration.test.js

**Interfaces:**
- Consumes: serializeSkillReference, escapeSkillReferenceLiteral, createSkillReferenceChip and current scoped resolver.
- Produces: composer.getParts() returning {type:'text',text} | {type:'reference',reference:SkillReference,labelSnapshot?}; composer.getWireText() returning only valid v1 tokens plus escaped literal text.
- submit gathers parts BEFORE editor.clear(), persists trusted parts in message and draft fields, and passes serialized request to existing runPrompt. For model readability, Task 6 expands this into authorized natural language at the LLM ingress, not at the editor.
- Legacy draft types node_type/node_instance/function can be read; when restored they become typed refs only if scoped lookup succeeds; otherwise inert text. The old serial @label〔...〕 appears only as historical literal text or verified old draft.

- [ ] **Step 1: RED tests.** From contenteditable with adjacent tags and Korean IME text, serialize→save→reload→copy→paste→submit and assert identity, blank spaces/newline and exact visible label remain. Literal manually typed ⟦ovll:ref:...⟧ remains literal text and not a structured chip; an old draft with node_type normalizes only by verified ID. Ensure the submit handler creates one user message, not duplicate.
- [ ] **Step 2: Run.** node --test test/ovllSkillComposerRoundtrip.test.js. Expected: FAIL.
- [ ] **Step 3: Implement.** Refactor composer tag creation to use shared view and typed parts; map keyboard @ choices to exact Skill v2 registry. Preserve existing resize(), blur/focus, Android IME, popup click gesture and attachment behavior unchanged. Save both canonical text and separate trusted message parts with consistency check.
- [ ] **Step 4: Verify.** node --test test/ovllSkillComposerRoundtrip.test.js test/ovllSkillStorageMigration.test.js test/workspaceArchitecture.test.js. Expected: PASS; inspect collapsed plus-only state and no keyboard reopening on manual picker.
- [ ] **Step 5: Commit.** git commit -am "feat(skill): round-trip trusted reference parts through composer"

### Task 5: User and AI messages share display, storage and history truth

**Files:**
- Modify: front/js/app.js (createMessage, addUserMessage, addAssistantMessage, existing message restore/historical search)
- Modify: front/js/ovllWorkspace.js (appendMessage)
- Modify: front/js/workspaceStore.js (normalizeMessage)
- Modify: front/css/chat.css
- Create: test/ovllSkillMessageRendering.test.js
- Inspect: front/js/libraryPage.js; front/js/ovllPointerActivity.js

**Interfaces:**
- Consumes: renderSkillReferenceParts, segmentSkillReferences and scoped resolver.
- Produces: persisted message {role,text,parts?}. text is exact canonical visible/source text and controls search/copy; parts is a verified optional typed description for user-originated trusted tokens.
- AI message may contain complete serialized v1 tokens and is rendered as chips only when resolved and allowed; historical plain text and unknown tokens remain text.
- Streaming interim token is text until closed; rendering cannot assert actual execution.

- [ ] **Step 1: RED tests.** User manually pastes a valid token string without trusted parts -> plain text; composer-generated trusted parts -> chip; AI string with valid token -> chip after resolution; two identical labels different IDs stay distinct; HTML remains inert; history/export/search return complete text not stripped labels; missing refs stay plain and no unexpected DOM focus.
- [ ] **Step 2: Run.** node --test test/ovllSkillMessageRendering.test.js. Expected: FAIL.
- [ ] **Step 3: Implement.** Route both app.js createMessage and ovllWorkspace.appendMessage through one DOM renderer. During restore reconstruct only verified parts or parse AI response; preserve existing message metadata, copy actions and runtime-step controls. Do not replace runtime UI or add Markdown engine.
- [ ] **Step 4: Verify.** node --test test/ovllSkillMessageRendering.test.js test/workspaceArchitecture.test.js test/ovllSkillComposerRoundtrip.test.js. Expected: PASS.
- [ ] **Step 5: Commit.** git commit -am "feat(skill): render verified references consistently in both chat roles"

### Task 6: Language-model reference instructions and verified prompt expansion

**Files:**
- Create: instructions/prompts/shared/skill-references.md
- Modify: instructions/registry.json; instructions/prompts/layers/entry.md, chat.md, response.md
- Modify: backend/ovllPointer/promptComposer.js, modelContract.js, localHost.js
- Create: test/ovllSkillLanguageContract.test.js
- Update: test/ovllPointerPromptComposer.test.js, test/ovllPointerPhaseContracts.test.js

**Interfaces:**
- Consumes: canonical SkillReference grammar and current allowedReferences() resolver output; no new model calls.
- Produces: formatSkillPrompt(text,{allowedReferences}) -> {requestText,issues}; server derives allowedReferences from its validated Skill snapshot, graphId and server-authorized saved functions, never a client-supplied allowlist. Runtime/host rejects mismatched references rather than inventing names.
- New registry module: shared.skill-references, order 90, requires core. layer.entry, layer.chat, layer.response require shared.skill-references. The module is included once by existing dependency resolution, not duplicated in modelContract text.
- Prompt text: human label plus exact machine token for Skill definition; canvas display "#skillId" plus graphId/token; AI output can include exact confirmed tokens only; unknown ref returns ordinary prose.

- [ ] **Step 1: RED tests.** A complete user ref expands to scoped human explanation plus token once; missing/forged refs and forged client-supplied allowlists cannot produce a Skill identity; normal chat unaffected; EXIT module included in assembly exactly once; direct answer and action-result response both use identical grammar; no changed provider call count.
- [ ] **Step 2: Run.** node --test test/ovllSkillLanguageContract.test.js. Expected: FAIL.
- [ ] **Step 3: Implement.** Register one instruction module into existing entry/chat/response assemblies. Provide formatSkillPrompt as a pure helper in backend/ovllPointer/skillReferenceContract.js (create), consuming the parser and allowed references derived from the server-validated graph snapshot and saved function scope; never trust arbitrary caller labels or allowlist. Adapt request only at context boundary, not graph scheduler. Preserve model budgets and update prompt versions.
- [ ] **Step 4: Verify.** node --test test/ovllSkillLanguageContract.test.js test/ovllPointerPromptComposer.test.js test/ovllPointerPhaseContracts.test.js test/ovllPointerQualityFlow.test.js. Expected: PASS with no new LLM call.
- [ ] **Step 5: Commit.** git add instructions/prompts/shared/skill-references.md backend/ovllPointer/skillReferenceContract.js test/ovllSkillLanguageContract.test.js && git commit -am "feat(skill): share reference rules across prompts and language output"

### Task 7: End-to-end integration, security and rendering checks

**Files:**
- Create: test/ovllSkillReferenceIntegration.test.js
- Modify: relevant files above only to correct verified contract regressions
- Update: instructions/README.md, backend/ovllPointer/README.md; docs/architecture/SKILL_LEGACY_EXCEPTIONS.md

**Interfaces:**
- Produces: one end-to-end Skill reference contract round-trip covering new and migrated graph, prompt expansion, assistant return, renderer and persisted conversation.

- [ ] **Step 1: RED integration test.** Real legacy fixtures -> Skill v2 store -> composer mention on custom Skill and canvas instance -> submit -> injected local model echoes allowed reference -> assistant message renders correct chip -> restore/reopen after Skill rename and deletion. Assert graph scope, identity, unchanged Run results, stable UI icon and text and zero unsafe HTML injection.
- [ ] **Step 2: Run.** node --test test/ovllSkillReferenceIntegration.test.js. Expected: FAIL before missing path corrections.
- [ ] **Step 3: Implement.** Fix only demonstrated integration breaks and document grammar/legacy exceptions. If any active Node term remains in UI or new persisted wire, trace owner and correct it without broad replacements.
- [ ] **Step 4: Verify.** npm test; run the focused integration test separately. Expected: PASS for all tests. In an available browser test environment verify Android keyboard, collapsed + control, IME, canvas mode, both chat roles and dark mode. Without device/real provider state explicitly unverified.
- [ ] **Step 5: Commit.** git add -A && git commit -m "test(skill): verify reference protocol and unified message rendering"

## Release and final audit

1. Start this plan only after all nine core migration tasks are complete and green. Do not implement against legacy Node runtime ad hoc.
2. Verify all seven task-level tests plus npm test with recorded output; preserve test fixture evidence for old fingerprints and old composer drafts.
3. Inspect every remaining Node-labelled file/property/visible string against docs/architecture/SKILL_LEGACY_EXCEPTIONS.md. Never replace DOM Node, Node.js or archived docs.
4. Evaluate browser, API and result wiring on staging and check actual backend deploy/version separately; static test pass does not establish live model correctness.
5. Before any shared-branch merge run the Superpowers whole-branch review. Stop on data-loss, missing reference authorization, XSS, fingerprint relaxation, model budget regression or mobile input regression.
6. Rollback: keep old localStorage key unmodified; if reference feature fails, render inert raw text and leave execution contracts intact, never silently rewrite or drop message contents.
