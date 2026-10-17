# Beta Hosted Page Slides & Pill Gesture Implementation Plan

> **실행 전 보완 필요 (2026-10-17):** 사용자가 Hosted Page별 `stationary` 스와이프 독립 요소와 `layout: immersive|stacked` 모드를 추가 요청했다. `docs/notes/frontend-layout-and-viewport-amendment.md` B/C항 검토·승인 후 Task 2·4 API/렌더/검증을 갱신해야 한다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-create main's Chat↔Canvas pill and horizontal slide gesture/detail as a page-declared, global Hosted Page control, supporting 1/2/N slides, mouse and touch, while preserving SideMenu and Canvas ownership.

**Architecture:** Top-level Page Host continues to own Workspace/Library activation. Each hosted page declares slide IDs/labels/elements, pill visibility and per-slide body-swipe permission to one focused Hosted Slides controller. Shell contains a global pill mount point. Input Manager arbitrates pointer streams without interpreting swipes; Shell independently owns SideMenu drag.

**Tech Stack:** Browser ES modules, Pointer Events, CSS transforms/backdrop-filter, requestAnimationFrame, matchMedia reduced motion, native node:test, Chromium visual check where available.

**Spec:** `docs/developing/frontend-runtime-and-hosted-swipes.md` §§1–4, 6–7; current `docs/developing/frontend-global.md` owns Shell/Page Host/Input Manager contracts.

## Global Constraints

- Work exclusively in `beta`; read `AGENTS.md`. Never alter `main`, merge or deploy, touch Cloudflare/Vercel/Render config, or add a new global/mobile manager.
- Main references: `front/js/workspaceUi.js`, `front/css/ui.css`, `front/js/shellMenu.js`. Preserve user-visible feel: drag progress, glass pill with progressing selection, page movement + opacity/depth, snap speed; don't claim pixel parity without screenshot comparison.
- Hosted slide count is independent of outer Page Host page identity. Pill appears **only** when `showPill===true && slides.length>=2`.
- Each slide declares `{id,label,element,allowContentSwipe?}`, with `allowContentSwipe` default `false`; Canvas-style pages explicitly opt out. Controls/editors/horizontal overflow areas have priority.
- Menu drawer gestures, pill gestures, and content gestures must not acquire the same pointer simultaneously. The Input Manager remains owner of ownership only; no global `preventDefault` on unclaimed streams.
- Fixtures in beta must remain clearly TEMPORARY. Real Chat, Canvas and Composer are not yet implemented.
- Respect prefers-reduced-motion; cleanup on page leave, cancel, blur, resize, menu open and BFCache. No `AGENTS.md` edits without notification.

## Review Focus

1. Vertical/diagonal touch scroll begins near a Chat control or a nested horizontal scroller: global content swipe must not steal it. Tasks 1, 3 tests.
2. Canvas slide requests `allowContentSwipe:false` but pill remains visible and usable: reject body drag while allowing pill drag and click. Tasks 2, 3 tests.
3. More than two slides or only one slide; progress math, aria/inert, pill widths, button labels and focus must remain correct. Task 2 tests.
4. Menu opens or Page Host leaves mid-drag; pointer capture, animated frame, active states and listeners must end with no stuck/double gesture. Tasks 1, 3, 4 tests.
5. Rapid reverse drag while snapping, viewport resize, reduced motion, touch vs mouse: no stale transform/incorrect selected slide. Tasks 2–4 tests.

---

### Task 1: Deferred directional pointer ownership

**Files:**
- Modify: `front/js/input/inputManager.js`, `docs/developing/frontend-global.md`
- Test: `tests/frontend/input-ownership.test.mjs`

**Interfaces:**
- Preserve `createInputManager({target})` and existing `registerOwner({element,signal,onStart,onMove,onEnd,onCancel})`.
- Extend `registerOwner` optionally with `onProbe(event)`. `onStart(event)` may return `"defer"`; while probing `onProbe` returns `"wait"` (continue), `false` (reject) or `true` (claim). Existing boolean true/false calls must not change behavior.

- [ ] **Step 1: Write failing tests** for existing immediate claim, defer→horizontal claim, vertical rejection, pointercancel, rejected child not falling through to parent, another pointer not hijacking, signal abort, no capture/default-cancellation while pending.
- [ ] **Step 2: Verify red.** Run: `node --test tests/frontend/input-ownership.test.mjs`. Expected: new defer assertions fail against old manager.
- [ ] **Step 3: Implement minimal probe state** (pointer identity, candidate, accepted session); no swipe semantics in manager. Claim/capture only after probe returns true. Cancel losing probe on pointerup/blur/abort; preserve legacy API.
- [ ] **Step 4: Verify green.** Run same command. Expected: all assertions pass.
- [ ] **Step 5: Commit** focused manager/tests: `feat(beta): support delayed pointer gesture claiming`.

### Task 2: Hosted Slides controller and progressing pill view

**Files:**
- Create: `front/js/shell/hostedSlides.js`, `front/css/hostedSlides.css`
- Modify: `front/index.html`, `docs/developing/frontend-global.md`
- Test: `tests/frontend/hosted-slides.test.mjs`

**Interfaces:**
- Consumes: Task 1 `input.registerOwner` with optional directional claim; Shell's pill mount `[data-hosted-pill]`, Page Host page lifecycle signals.
- Produces: `createHostedSlides({ pillHost, input })` with `activateForPage({ root, slides, showPill=false, signal })` returning `{goTo(id,{immediate=false}={}),getCurrentSlide(),destroy()}`, plus `cancel(reason)` and `destroy()` on controller; only one active hosted page group.

- [ ] **Step 1: Write failing tests** for 0/1/2/3 pages, duplicate/missing slide elements error, default swipe opt-out, pill visibility false, pill click, keyboard focus/aria-selected, selected nonvisible slide inert/aria-hidden, same-ID navigation no-op and page-leave lifecycle cleanup.
- [ ] **Step 2: Verify red.** Run: `node --test tests/frontend/hosted-slides.test.mjs`. Expected: missing interface failures.
- [ ] **Step 3: Implement progress model + global pill.** Slide translation using viewport root width and normalized progress `0..(N-1)`, pill thumb position `progress * pillItemWidth`, glass surface/backdrop-blur, soft opacity interpolation following main's 0.92→1 pattern. Use width based on slide count, not constant `9.375rem` for N>2. Snap duration `280 + 55*abs(delta)` ms and ease-out quartic, with reduced-motion immediate snap. CSS-only fallback if blur unsupported.
- [ ] **Step 4: Verify green.** Run same command. Expected: all assertions pass, no focus on inactive slide.
- [ ] **Step 5: Commit** focused controller/view/tests: `feat(beta): declare hosted slides and render global pill`.

### Task 3: Content and pill swipes, independent SideMenu drawer gesture

**Files:**
- Modify: `front/js/shell/hostedSlides.js`, `front/js/shell/appShell.js`, `front/css/shell.css`, `front/js/boot.js`
- Test: `tests/frontend/hosted-gesture.test.mjs`, `tests/frontend/shell-menu-gesture.test.mjs`

**Interfaces:**
- Consumes: `activateForPage` slide declaration, Task 1 deferred claim, `createAppShell({ element,onNavigate,onMenuOpen,input })` (new optional `input` arg).
- Produces: `shell.getMenuOpen(): boolean` (read-only). Menu status is owned only by Shell; Hosted Slides receives explicit cancel/disable callback at Boot on menu open, not a duplicated menu-open flag.

- [ ] **Step 1: Write failing tests**: pill mouse/touch drag threshold 5px, velocity 0.34 px/ms, click without drag; content touch horizontal threshold 8px, vertical/focus/scroll blockers; Chat left swipe moves Canvas, Canvas body refuses; Menu opening mid-swipe aborts; menu panel left swipe to close at >22% or velocity <-0.34 and does not advance slides.
- [ ] **Step 2: Verify red.** Run: `node --test tests/frontend/hosted-gesture.test.mjs tests/frontend/shell-menu-gesture.test.mjs`. Expected: missing swipe/menu behavior.
- [ ] **Step 3: Implement view-proportional progress and commit logic**; held pill drag and page swipe share one renderer but use separate input owners. Do not grab content swipe from vertical scroll/controls/canvas. Use Shell `onMenuOpen` to call `input.cancel("menu-open")` and `hostedSlides.cancel("menu-open")`; menu uses only its panel listener/owner. Avoid competing page gesture under opened overlay and docked desktop sidebar.
- [ ] **Step 4: Verify green.** Run same command. Expected: all pass, old Shell menu tests still pass.
- [ ] **Step 5: Commit** focused gesture integration/tests: `feat(beta): coordinate menu and hosted swipe gestures`.

### Task 4: Temporary Workspace integration, visual parity and lifecycle

**Files:**
- Modify: `front/js/dev/uiTest.js`, `front/css/uiTest.css`, `front/js/boot.js`, `front/css/hostedSlides.css`, `docs/developing/frontend-global.md`
- Test: `tests/frontend/hosted-integration.test.mjs`

**Interfaces:**
- Consumes: `hostedSlides.activateForPage({root,slides,showPill,signal})` in `Page Host.register(... {onEnter, onLeave})`; `Page Host` continues to own `workspace/library` only.
- Produces: default beta Workspace declares *temporary* Chat/Canvas sections, Chat `allowContentSwipe:true`, Canvas `false`, `showPill:true`. Library remains 1-page/no-pill; mock Composer and height/theme controls remain accessible, labeled temporary.

- [ ] **Step 1: Write failing tests** for activation→pill visible Chat/Canvas, Library→pill gone, restoration after back, 3-slide synthetic integration, pointer cancellation on pageleave, viewport resize during snap, BFCache, reduced motion, no state kept after destroy, no unnecessary duplicate page state.
- [ ] **Step 2: Verify red.** Run: `node --test tests/frontend/hosted-integration.test.mjs`. Expected: failures with old two-card fixture.
- [ ] **Step 3: Integrate lifecycle and finish CSS detail.** Main-referenced compact centered pill and moving highlight; adjacent slide revelation through transform/opacity; header veil gradient; responsive safe-area placement, touch-action policy, pixel-conscious drag. Ensure viewport/keyboard framing from runtime plan is consumed without recoding it in Hosted Slides.
- [ ] **Step 4: Verify green + visual.** Run: `node --test tests/frontend/*.test.mjs`. Expected: zero failures. Use real browser screenshots/video at 1280×800, 390×844, 844×390 with touch/pointer to compare main's interaction; record unavailable environments as NOT VERIFIED, never call parity complete from mocks.
- [ ] **Step 5: Commit** integrated fixtures + docs only after verification: `feat(beta): wire hosted slides into beta workspace`.

## Completion and handoff

- Test nested control, canvas pinch start/cancel, menu open/close with pointer capture, keyboard Escape/Tab, reduced motion, orientation and physical keyboard where available. Real Canvas/Composer integration remains a distinct later deliverable because they do not exist on beta.
- Final whole-branch review against design, use `git diff main` to check no changes and verify no configuration modification; do not merge into main or deploy automatically.
