# OVLL Server-Owned Node Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `server.js` the sole built-in node-icon authority and replace all seven built-in icons with one rounded monoline SVG family.

**Architecture:** Built-in node definitions continue to arrive through the existing node-definition API, but the frontend stops rewriting their `icon` fields. The frontend SVG library remains responsible only for generic UI glyphs. The server-authored SVGs own their stroke geometry, while node CSS owns only rendered size and color inheritance.

**Tech Stack:** Node.js ESM, Express, browser JavaScript, CSS, Node `node:test`

**Spec:** `docs/superpowers/specs/2026-10-07-node-icon-authority-and-visual-redesign.md`

## Global Constraints

- `server.js` `defaultNodeDef.*.icon` is the canonical source for built-in node icon SVG.
- `front/js/api.js` must not replace built-in server icons with local frontend copies.
- `front/js/svgLibrary.js` must not own built-in node icons.
- Generic UI icons remain frontend-owned.
- Cached node definitions preserve the icon already stored from the server.
- All built-in node icons use `viewBox="0 0 20 20"`, outline-first construction, rounded line caps/joins, visibly soft radii, minimal or no solid fills, and `currentColor`.
- Node icon CSS must not globally overwrite authored SVG stroke widths.
- Keep existing node colors, layout, execution, connection, parameter, and interaction behavior unchanged.
- Visual mappings are fixed: start=rounded play, research=globe, organize=brain, judge=balance scales, write=broad rounded pen nib, file=rounded folder, createFile=rounded four-point sparkle.
- The write icon must be noticeably broader and softer than the earlier narrow proposal.

## Review Focus

- Offline startup with cached server definitions must retain cached built-in SVGs rather than requiring the frontend icon library; Task 1 adds an offline-cache regression test.
- Custom node definitions must keep their custom icon untouched while built-in authority changes; Task 1 keeps an explicit custom-icon assertion.
- Removing node icon ownership must not remove generic UI SVGs or the `get()/has()` library API used elsewhere; Task 1 adds a generic-icon API assertion.
- CSS in normal, dark, and mobile node states must not flatten per-icon stroke hierarchy; Task 2 asserts the global `.vc-node-icon svg [stroke]` override is absent while size rules remain.
- A future icon edit must not drift back to filled silhouettes/background-cutout geometry; Task 2 asserts all seven server icons use the shared 20x20/currentColor/rounded-outline contract and reject `fill="currentColor"` and `var(--node)`.

---

### Task 1: Move built-in icon authority from frontend to server

**Files:**
- Modify: `test/node-icon-authority.test.js`
- Modify: `front/js/api.js`
- Modify: `front/js/svgLibrary.js`

**Interfaces:**
- Consumes: existing `AstraAPI.getNodeDefinitions(options)`, localStorage key `ovll:node-definitions`, and generic `OvllSvgLibrary.get(name) / has(name)`.
- Produces: node definitions whose `icon` values are preserved exactly from server or cache; `OvllSvgLibrary` exposes generic UI glyphs only and no built-in-node icon API.

- [ ] **Step 1: Rewrite the authority tests to fail against the current frontend-owned behavior**

In `test/node-icon-authority.test.js`:

- Rename the fresh-definition test to `fresh node definitions preserve server-owned built-in icons`.
- For every built-in type, assert `definitions[type].icon === serverDefinitions("fresh")[type].icon`.
- Assert the stored localStorage copy contains the same server icon.
- Keep the custom node assertion unchanged.
- Rename the offline test to `stored server node icons survive offline without frontend normalization` and assert each cached icon equals the stored server value.
- Add `svg library exposes generic icons but no built-in node icon authority` asserting:
  - `OvllSvgLibrary.has("composerSend") === true`
  - `OvllSvgLibrary.get("composerSend")` contains `<svg`
  - `OvllSvgLibrary.getNodeIcon === undefined`
  - `OvllSvgLibrary.hasNodeIcon === undefined`
  - `OvllSvgLibrary.nodeIcons === undefined`

- [ ] **Step 2: Run the authority test and verify RED**

Run: `node --test test/node-icon-authority.test.js`

Expected: FAIL because current `applyLocalNodeIcons()` replaces server/cached built-in icons and `OvllSvgLibrary` still exposes node icon APIs.

- [ ] **Step 3: Remove frontend normalization from `front/js/api.js`**

Delete the `SvgLibrary` dependency used only for node icon normalization and delete `applyLocalNodeIcons(definitions)`.

Change `readStoredNodeDefinitions()` to return a valid parsed definitions object directly, without rewriting `icon`.

In the fetch path of `getNodeDefinitions()`, store and cache the server-returned definitions directly; do not add any icon transformation layer.

- [ ] **Step 4: Remove built-in node icons from `front/js/svgLibrary.js`**

Delete `NODE_ICONS`, `getNodeIcon(type)`, `hasNodeIcon(type)`, and the exported `nodeIcons` property.

Preserve `ICONS`, `get(name)`, `has(name)`, and all generic UI SVG definitions unchanged.

- [ ] **Step 5: Run the authority test and verify GREEN**

Run: `node --test test/node-icon-authority.test.js`

Expected: PASS with all authority, cache, custom-node, and generic-library assertions green.

- [ ] **Step 6: Commit Task 1**

Commit files:
`test/node-icon-authority.test.js`
`front/js/api.js`
`front/js/svgLibrary.js`

Commit message: `refactor: make server authoritative for node icons`

### Task 2: Replace server icons with the rounded monoline set and preserve authored stroke geometry

**Files:**
- Modify: `test/node-visual-contract.test.js`
- Modify: `server.js`
- Modify: `front/css/node.css`

**Interfaces:**
- Consumes: server-owned `defaultNodeDef[type].icon` established by Task 1 and existing `.vc-node-icon svg` size rules.
- Produces: seven server-owned rounded monoline SVGs rendered at the existing node icon dimensions without CSS stroke-width rewriting.

- [ ] **Step 1: Replace obsolete visual-contract assertions with server-owned monoline assertions**

In `test/node-visual-contract.test.js`:

- Read `server.js` instead of using `svgLibrary.js` as the built-in icon source.
- Add a small helper that scopes to the `defaultNodeDef` source block and extracts each built-in type's `icon` template string.
- Keep the existing icon alignment assertions for `width: 1.46rem`, `flex: 0 0 1.46rem`, `justify-content: flex-start`, and SVG rendered width.
- Replace the current assertion that requires `.vc-node-icon svg [stroke] { stroke-width: 1.2; }` with an assertion that the selector/rule is absent.
- Replace `default node icons use compact filled silhouettes with minimal inner detail` with `server-owned node icons share one rounded monoline visual contract`.
- For each of `start, research, organize, judge, write, file, createFile`, assert the extracted SVG:
  - contains `viewBox="0 0 20 20"`
  - contains `stroke="currentColor"`
  - contains `stroke-linecap="round"`
  - contains `stroke-linejoin="round"`
  - does not contain `fill="currentColor"`
  - does not contain `var(--node)`
- Add semantic-shape smoke assertions:
  - research contains a circular globe outer contour
  - judge contains distinct beam/stem and two bowl paths
  - file contains one rounded folder contour
  - createFile contains one four-point sparkle contour
- Add a write-icon geometry assertion against the chosen final nib path so the outer nib is wider than the previous narrow design and uses rounded joins.

- [ ] **Step 2: Run the visual-contract test and verify RED**

Run: `node --test test/node-visual-contract.test.js`

Expected: FAIL because built-in icons still live in `svgLibrary.js`, several server icons do not match the required mappings/style, and CSS still forces `stroke-width: 1.2`.

- [ ] **Step 3: Redraw the seven `server.js` built-in icons**

Replace only `defaultNodeDef.*.icon` SVG markup.

Use the fixed mappings:

- `start`: rounded outline play triangle with softened corners.
- `research`: globe with circular outer contour and minimal rounded latitude/longitude lines.
- `organize`: symmetric brain outline with a center split and few rounded folds.
- `judge`: compact balance scales with rounded beam, stem, and shallow bowls.
- `write`: squat, broad pen nib; outer contour visibly wider than tall/narrow earlier versions, with a simple center slit/ink detail and generous rounded joins.
- `file`: rounded folder outline with a soft tab transition.
- `createFile`: rounded outline four-point sparkle with generous inner space.

Shared authored SVG rules:

- `viewBox="0 0 20 20"`
- `fill="none"` on the root
- primary geometry uses `stroke="currentColor"`
- authored stroke weights stay in a narrow family around the existing visual scale
- every stroked path uses round caps and joins where applicable
- no `fill="currentColor"`
- no `var(--node)`
- preserve each node's existing `color` definition

Do not modify names, descriptions, params, ports, runtime behavior, or colors.

- [ ] **Step 4: Remove the CSS stroke-width override**

Delete only:

`.vc-node-icon svg [stroke] { stroke-width: 1.2; }`

Keep `.vc-node-icon`, `.vc-node-icon svg`, dark-mode, and mobile size/alignment rules otherwise unchanged.

- [ ] **Step 5: Run the visual-contract test and verify GREEN**

Run: `node --test test/node-visual-contract.test.js`

Expected: PASS including common monoline rules, semantic smoke assertions, broader write-nib assertion, and absence of the CSS stroke override.

- [ ] **Step 6: Run the full regression suite**

Run: `npm test`

Expected: all tests PASS with 0 failures.

- [ ] **Step 7: Commit Task 2**

Commit files:
`test/node-visual-contract.test.js`
`server.js`
`front/css/node.css`

Commit message: `style: unify node icons as rounded monoline svg`

## Final Verification

- [ ] Run `npm test` once more from the final branch state and confirm 0 failures.
- [ ] Inspect the final diff to confirm no node layout, connection, runtime, parameter, or unrelated UI code changed.
- [ ] Render the actual node header in both light and dark mode if a browser surface is available; confirm globe, brain, scales, broad pen nib, folder, and sparkle have comparable optical mass and the pen nib is visibly broader/rounder than the previous proposal.
