# ovll UI Architecture Overhaul Design

**Date:** 2026-10-05

## Intent

Refactor the existing ovll frontend so the visual hierarchy, interaction hierarchy, and source hierarchy match the product model already implied by the application:

- Chat + Canvas are two modes of one workspace.
- Library is a separate application page.
- Sidebar is global navigation, not part of either workspace mode.
- Files use shared card/preview primitives.
- Existing runtime, backend, workspace persistence, Gemini execution, canvas execution, and file-store contracts must keep working.

The goal is not a cosmetic reskin. The goal is to remove patch-on-patch styling, make page ownership obvious in DOM/CSS/JS, reduce redundant tracked source copies, and make desktop/mobile behavior feel intentionally designed.

## Current Findings

### 1. App hierarchy is visually and structurally mixed

`front/index.html` places topbar, workspace pages, library overlay, and composer as peers inside `#app-stage`. Library is described as standalone but behaves like a z-index overlay that individually hides `#workspace`, `#topbar`, `#composer`, and `#ovll-shell-menu`.

This makes one logical page depend on hiding four unrelated layers instead of switching one app-page container.

### 2. CSS has accumulated corrective layers

`front/css/ui.css` contains repeated corrective sections for the same controls:

- COMPOSER STABILITY
- COMPOSER ATTACH FIX
- COMPOSER ATTACH DETAIL
- COMPOSER ICON DETAIL
- OVLL UI COHESION
- OVLL SIMPLE CONTROL SURFACES

The same selectors are redefined many times. In the current file, `#composer-form` is defined eight times, `#mode-switch` seven times, `#composer-submit` seven times, and `#composer-attach` six times.

This makes final appearance depend on source order instead of component ownership.

### 3. Layering uses unrelated magic numbers

Current CSS uses z-index values such as 40, 100, 108, 110, 150, 220, 1001, and 1200 without a shared layer scale. Library, sidebar, topbar, canvas speech, previews, and notices therefore form an accidental stack rather than an explicit one.

### 4. Sidebar primary navigation has a broken hierarchy

`.ovll-sidebar-primary` is a two-column grid but contains three peer actions: New chat, Search, Library. This makes the third action structurally orphaned and gives global navigation no stable visual rhythm.

### 5. Desktop Library throws away useful context

Selecting a file applies `.has-selection` and hides the browser entirely. This makes sense on a phone, but on desktop it removes the file list even though there is enough width for a master-detail layout.

### 6. Library page lacks keyboard/focus ownership

The Library has no page-level Escape handling, no focus handoff when opened, and no restoration of the previously focused control when closed.

### 7. Tracked backup copies pollute the source tree and search

The active frontend directory contains `.bak` and `.astra-bak` copies next to live files. Root also contains server backup snapshots. Git already provides history, so these copies create false search hits and increase ambiguity about canonical source.

### 8. Large frontend files have mixed responsibilities

`front/js/app.js` is ~6.6k lines and contains message rendering, composer behavior, workflow planning, runtime activity UI, artifact preview UI, canvas orchestration, workspace persistence, and initialization. `canvasNode.js` is ~5.1k lines.

A full split of those files is too risky to combine with a visual rewrite. This pass will reduce source ambiguity and page ownership first, while keeping existing public globals and runtime contracts stable.

## Design

### A. Page ownership

Introduce one explicit workspace shell:

```text
#app
  #app-stage
    #workspace-shell
      #topbar
      #workspace
        #chat-page
        #canvas-page
      #composer
    #library-page
    #ovll-shell-menu   (injected global navigation)
```

`#workspace-shell` owns all UI that belongs to Chat/Canvas. Library becomes its sibling, which makes page switching one state transition instead of hiding several unrelated nodes.

The sidebar remains injected into `#app-stage` so it is globally owned.

### B. Layer scale

Define semantic layer tokens in `front/css/style.css`:

- `--layer-content`
- `--layer-topbar`
- `--layer-composer`
- `--layer-sidebar`
- `--layer-page`
- `--layer-overlay`
- `--layer-notice`

Components use tokens instead of independent z-index integers.

### C. Surface and rail system

Add shared layout/surface tokens for:

- conversation content rail
- wide application rail
- control surface
- strong control surface
- hover surface
- standard control radius
- panel radius

Existing variable names remain available so behavior code and legacy selectors do not break.

### D. Composer consolidation

Keep the existing composer behavior and IDs. Replace the stack of corrective CSS sections with one final component section that owns:

- composer width
- attachment button
- input spacing
- submit button sizing
- focus state
- responsive sizing
- coarse-pointer 16px input protection

No new JavaScript behavior is required.

### E. Sidebar hierarchy

Change primary navigation from a two-column grid to a vertical navigation stack. Actions become left-aligned rows with consistent icon/label rails.

Search remains an expandable field below the action that invokes it.

Conversation sections and long-press/context behavior remain unchanged.

### F. Library desktop/mobile behavior

Desktop (`>46rem`):
- no selection: browser uses the full page
- selection: browser and detail are visible simultaneously in a master-detail split
- browser keeps scroll position while preview changes

Mobile:
- selection continues to replace the browser with detail
- close returns to browser

This keeps the current interaction model on small screens while improving desktop information density.

### G. Library focus behavior

On open:
- remember the active element
- show the page
- focus search when available, otherwise back control

On Escape:
- if detail is open, close detail first
- otherwise leave Library

On page close:
- restore focus to the element that opened Library when still connected

### H. Source cleanup

Remove tracked frontend and server backup snapshots that duplicate live source:
- `front/css/*.bak`
- `front/css/*.astra-bak`
- `front/js/*.bak`
- `front/js/*.astra-bak`
- `server.js.bak`
- `server.js.astra-bak`
- `server.js.astra-before-memory-rework`

Do not remove `.astra-baseline/` in this pass because it is a named baseline collection rather than an accidental adjacent source duplicate.

Do not delete root legacy runtime-looking files without a separate behavior audit.

## Compatibility Constraints

- No new runtime dependency.
- Keep vanilla HTML/CSS/JS.
- Preserve all existing element IDs consumed by JavaScript.
- Preserve `global.AstraUI`, `global.AstraApp`, `global.OvllLibraryPage`, `global.OvllShellMenu`, `global.mountCanvasNode`, and existing public runtime contracts.
- Do not change backend API shapes.
- Do not change workspace persistence schema.
- Do not change canvas workflow schema.
- Preserve light/dark theme.
- Preserve reduced-motion behavior.
- Preserve mobile safe-area and keyboard viewport handling.
- Avoid visual effects that make text/control contrast weaker.

## Verification

Add `test/uiArchitecture.test.js` using Node's built-in test runner and filesystem APIs. It will verify source-level architecture contracts without introducing DOM dependencies:

1. workspace shell owns topbar/workspace/composer and Library is its sibling
2. semantic layer tokens exist
3. legacy corrective UI section names are gone
4. sidebar primary navigation is single-column
5. Library has a desktop master-detail rule and mobile replacement rule
6. Library JavaScript implements Escape/focus handoff
7. adjacent tracked backup source files are absent

Existing `npm test` remains the project verification command.

## Non-goals

- No backend feature rewrite.
- No complete split of `app.js` or `canvasNode.js`.
- No framework migration.
- No redesign of workflow execution semantics.
- No replacement of the existing visual identity with an unrelated design language.
