# ovll UI Architecture Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ovll's UI hierarchy, source hierarchy, and desktop/mobile UX match its product model without changing runtime/backend contracts.

**Architecture:** Introduce a first-class workspace shell and separate Library page, consolidate layered CSS patches into owned component rules, establish semantic visual layers/tokens, and improve Sidebar/Library information hierarchy. Preserve the existing global JavaScript APIs and behavior contracts.

**Tech Stack:** Vanilla HTML, CSS, browser JavaScript, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-05-ui-architecture-overhaul-design.md`

## Global Constraints

- No new runtime dependency.
- Keep vanilla HTML/CSS/JS.
- Preserve all existing element IDs consumed by JavaScript.
- Preserve `global.AstraUI`, `global.AstraApp`, `global.OvllLibraryPage`, `global.OvllShellMenu`, `global.mountCanvasNode`.
- Do not change backend API shapes.
- Do not change workspace persistence or canvas workflow schemas.
- Preserve light/dark theme, reduced motion, safe areas, and keyboard viewport handling.
- Do not delete `.astra-baseline/`.
- Do not delete root legacy runtime-looking files in this plan.

## Review Focus

- Mobile viewport resize while composer is focused must still keep topbar/workspace/composer aligned.
- Library opened from sidebar and closed by Escape must restore focus without reopening sidebar.
- Library file deletion while detail is open must return to a valid browser state.
- Small phone Library selection must not render browser and detail side-by-side.
- Desktop Library selection must retain browser scroll/context while replacing only the detail pane.

---

### Task 1: Add UI architecture source-contract tests

**Files:**
- Create: `test/uiArchitecture.test.js`

**Interfaces:**
- Consumes: existing source tree.
- Produces: source-level architecture regression tests executed by existing `npm test`.

- [ ] **Step 1: Write failing tests**

Tests read `front/index.html`, `front/css/style.css`, `front/css/ui.css`, `front/css/library.css`, `front/css/shellMenu.css`, and `front/js/libraryPage.js` and assert:
- `#workspace-shell` exists and encloses `#topbar`, `#workspace`, `#composer`
- `#library-page` appears after the closing `#workspace-shell`
- semantic `--layer-*` tokens exist
- legacy corrective headings are absent from `ui.css`
- Sidebar primary grid is single-column
- Library desktop master-detail media rule exists
- Library page JavaScript contains Escape handling and focus restoration
- no adjacent `.bak` / `.astra-bak` files remain in `front/css`, `front/js`, or root server backups

- [ ] **Step 2: Run test to verify RED**

Run: `npm test`

Expected: new UI architecture tests fail against the current source.

- [ ] **Step 3: Commit test-only change**

Commit: `test: define UI architecture contracts`

### Task 2: Establish app shell and semantic design tokens

**Files:**
- Modify: `front/index.html`
- Modify: `front/css/style.css`

**Interfaces:**
- Consumes: existing IDs queried by frontend scripts.
- Produces: `#workspace-shell`, semantic layer tokens, shared layout/surface tokens.

- [ ] **Step 1: Wrap topbar/workspace/composer in `#workspace-shell`**

Keep all existing IDs and order within the workspace shell. Move `#library-page` to be a sibling of `#workspace-shell` inside `#app-stage`.

- [ ] **Step 2: Add semantic tokens to `:root`**

Add exact token names:
- `--content-rail`
- `--wide-rail`
- `--control-size`
- `--surface-hover`
- `--layer-content`
- `--layer-topbar`
- `--layer-composer`
- `--layer-sidebar`
- `--layer-page`
- `--layer-overlay`
- `--layer-notice`

- [ ] **Step 3: Re-run source-contract checks**

Expected: shell/token assertions pass; later task assertions remain red.

- [ ] **Step 4: Commit**

Commit: `refactor: establish app shell hierarchy`

### Task 3: Consolidate topbar/composer/control styling

**Files:**
- Modify: `front/css/ui.css`

**Interfaces:**
- Consumes: design tokens from Task 2 and existing control IDs.
- Produces: one authoritative composer/control styling block and semantic z-index usage.

- [ ] **Step 1: Replace magic layer numbers in primary workspace controls**

Use `var(--layer-topbar)`, `var(--layer-composer)`, `var(--layer-overlay)`, `var(--layer-notice)` where applicable.

- [ ] **Step 2: Remove patch-stack sections**

Remove these headings and their duplicate corrective declarations:
- COMPOSER STABILITY
- COMPOSER ATTACH FIX
- COMPOSER ATTACH DETAIL
- COMPOSER ICON DETAIL
- OVLL UI COHESION
- OVLL SIMPLE CONTROL SURFACES

- [ ] **Step 3: Add one `WORKSPACE CONTROL SYSTEM` section**

This section owns final composer/attach/input/submit sizing, shared control surfaces, focus state, responsive sizing, and coarse-pointer 16px input protection.

- [ ] **Step 4: Re-run source-contract checks**

Expected: legacy-heading assertion passes.

- [ ] **Step 5: Commit**

Commit: `refactor: consolidate workspace controls`

### Task 4: Repair Sidebar information hierarchy

**Files:**
- Modify: `front/css/shellMenu.css`

**Interfaces:**
- Consumes: existing Sidebar DOM from `shellMenu.js`.
- Produces: single-column primary navigation and semantic sidebar layer.

- [ ] **Step 1: Convert `.ovll-sidebar-primary` to one-column navigation**

Set `grid-template-columns: minmax(0,1fr)`.

- [ ] **Step 2: Left-align primary actions**

Use consistent icon/label rail, full-width actions, and remove first-child-only visual dominance so New chat, Search, and Library are peers.

- [ ] **Step 3: Replace hardcoded Sidebar z-index with `var(--layer-sidebar)`**

- [ ] **Step 4: Re-run source-contract checks**

Expected: Sidebar assertion passes.

- [ ] **Step 5: Commit**

Commit: `refactor: fix sidebar navigation hierarchy`

### Task 5: Make Library a responsive master-detail page

**Files:**
- Modify: `front/css/library.css`
- Modify: `front/js/libraryPage.js`

**Interfaces:**
- Consumes: `#workspace-shell`, existing FileStore/PreviewEngine APIs.
- Produces: desktop master-detail behavior, mobile replacement behavior, focus ownership, Escape handling.

- [ ] **Step 1: Switch page visibility against one owner**

When `:root[data-app-page="library"]`, hide `#workspace-shell` instead of separately hiding workspace/topbar/composer/sidebar.

Keep global Sidebar visually unavailable while Library is active by page state, but do not duplicate individual workspace selectors.

- [ ] **Step 2: Add desktop master-detail layout**

For widths above 46rem, `.ovll-library-content.has-selection` uses two columns and keeps both browser and detail visible.

- [ ] **Step 3: Preserve mobile replacement layout**

At or below 46rem, selected detail hides browser and fills the page.

- [ ] **Step 4: Add focus lifecycle to `libraryPage.js`**

Store the opener element, focus search/back on show, handle Escape (detail first, page second), and restore connected opener focus on hide.

- [ ] **Step 5: Parse-check `libraryPage.js` and run source-contract checks**

Expected: JavaScript parses; Library assertions pass.

- [ ] **Step 6: Commit**

Commit: `feat: improve library navigation and detail UX`

### Task 6: Remove adjacent backup source copies

**Files:**
- Delete: `front/css/chat.css.astra-bak`
- Delete: `front/css/chat.css.bak`
- Delete: `front/css/ui.css.astra-bak`
- Delete: `front/css/ui.css.bak`
- Delete: `front/js/api.js.astra-bak`
- Delete: `front/js/api.js.bak`
- Delete: `front/js/app.js.astra-bak`
- Delete: `front/js/app.js.bak`
- Delete: `server.js.bak`
- Delete: `server.js.astra-bak`
- Delete: `server.js.astra-before-memory-rework`

**Interfaces:**
- Consumes: Git history as the canonical rollback mechanism.
- Produces: one canonical active source copy per adjacent file.

- [ ] **Step 1: Verify all listed files are unreferenced by active runtime paths**

Use repository search and `server.js` static configuration.

- [ ] **Step 2: Delete listed backups**

- [ ] **Step 3: Re-run source-contract checks**

Expected: backup-file assertion passes.

- [ ] **Step 4: Commit**

Commit: `chore: remove duplicate source backups`

### Task 7: Final verification and review

**Files:**
- Review all modified files.

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: verified branch ready for review.

- [ ] **Step 1: Re-fetch branch files and run source-contract assertions against branch contents**

Expected: all architecture assertions pass.

- [ ] **Step 2: Parse-check modified browser JavaScript**

Use a JavaScript parser/evaluator that validates syntax without executing browser globals.

Expected: no syntax errors.

- [ ] **Step 3: Inspect branch diff against main**

Verify only intended files changed/deleted.

- [ ] **Step 4: Run project tests when a command-execution environment is available**

Run: `npm test`

Expected: all tests pass. If command execution is unavailable, report that limitation explicitly and do not claim runtime test success.

- [ ] **Step 5: Whole-branch code review**

Review for mobile viewport regressions, focus lifecycle, CSS source-order coupling, accidental API/ID changes, and stale selectors.

