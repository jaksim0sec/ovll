# Beta Runtime Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build verified, responsibility-scoped mobile viewport/keyboard framing, user theme and environment capabilities, cache loading/revalidation, and observable PWA/version state in beta without inventing a backend or mobile manager.

**Architecture:** Boot composes independent owners. Shell owns the app frame, settings owns theme, data owns cache + optional verified data fetching, app lifecycle owns PWA and app-version observation. Page Host remains the sole SPA page identity; device-dependent policy stays with the relevant feature.

**Tech Stack:** ES modules, browser CSS + VisualViewport, matchMedia, localStorage, existing IndexedDB adapter, native node:test, manual mobile Chromium/Safari validation as available.

**Spec:** `docs/developing/frontend-runtime-and-hosted-swipes.md` §§1, 2, 4, 5, 6, 7. Existing contracts: `docs/developing/frontend-global.md`, `docs/developing/frontend-data.md`.

## Global Constraints

- Work only in `beta`; never change/merge/deploy `main`, Vercel, Render or Cloudflare configuration. Read `AGENTS.md` before working.
- `front/` serves static ES modules with no third-party UI framework, build system or added runtime dependencies.
- Do not introduce `MobileManager`, `GlobalManager`, duplicate `currentPage`, fabricated server endpoints, SW files or app version numbers.
- Preserve `Page Host`'s active page and `Input Manager`'s pointer ownership; each owner decides its own mobile/desktop behavior.
- Treat `main` as read-only visual/tech reference. Existing real Composer/Canvas/Chat are **not present** in beta. Keep temporary fixtures explicitly temporary.
- Do not set `VirtualKeyboard.overlaysContent = true` globally. No force reload, unsolicited fetch/retry, or silent failed-cache success.
- Changes to `AGENTS.md`, if needed, must be explicitly disclosed before editing.

## Review Focus

1. VisualViewport `height` reduces while `offsetTop` changes and the mock Composer is focused; Shell frame must stay within the visible screen. Task 1 test + device QA.
2. `visualViewport` unavailable or values invalid, and standalone/PWA differs from browser; never derive a false keyboard-open flag. Tasks 1 and 4 tests.
3. Storage unavailable/throws, and theme preference switches while OS theme changes; UI must keep a consistent transient setting without crashing. Task 2 tests.
4. Concurrent cache refresh returns older or missing revision, or is cancelled; reject stale data and expose error, do not duplicate requests. Task 3 tests.
5. Version source or service worker missing/offline; report `unknown`/unavailable, never invent `update ready` or reload. Task 4 tests.

---

### Task 1: Visible viewport / keyboard framing contract

**Files:**
- Modify: `front/js/shell/appShell.js`, `front/css/shell.css`, `front/css/uiTest.css`
- Test: `tests/frontend/shell-viewport.test.mjs`

**Interfaces:**
- Consumes: existing `createAppShell({ element, onNavigate, onMenuOpen })`; browser `visualViewport.height/offsetTop`.
- Produces: Shell CSS `--shell-visible-height` and `--shell-visible-top` on `#app`; no page-DOM lookup.

- [ ] **Step 1: Write failing tests** for initialization, IME-like shrink 780→480 + offsetTop 12→24, repeated coalesced resize/scroll, fallback with invalid VisualViewport, orientation/pageshow, cleanup; add fixture focus position check where DOM browser is available.
- [ ] **Step 2: Run failing tests.** Run: `node --test tests/frontend/shell-viewport.test.mjs`. Expected: nonzero exit on the not-yet-met tests; existing behavior that already passes must not be rewritten just to create a failure.
- [ ] **Step 3: Fix only demonstrated shortcomings** of the already implemented Shell viewport mapping; ensure the **Composer fixture is inside the resized Page Host** rather than receiving an unrelated global transform. Respect mobile browser native scroll/IME. Do not claim physical keyboard test from synthetic height events.
- [ ] **Step 4: Verify.** Run: `node --test tests/frontend/shell-viewport.test.mjs`. Expected: all named checks pass, zero failures; physical keyboard gaps explicitly listed.
- [ ] **Step 5: Commit** focused modifications with message `test(beta): verify shell visible viewport and keyboard framing` (implementation fix prefix `fix(beta)` only if code changes).

### Task 2: User theme and capability observation

**Files:**
- Create: `front/js/settings/theme.js`
- Modify: `front/css/base.css`, `front/js/boot.js`, `front/js/dev/uiTest.js`, `front/css/uiTest.css`
- Test: `tests/frontend/theme.test.mjs`

**Interfaces:**
- Produces: `createThemeSettings({ root, storage, media })` → `getTheme(): "system"|"dark"|"light"`, `setTheme(theme)`, `subscribe(callback)` unsubscribe, `destroy()`; resolved attribute `root.dataset.theme`. Only this owner persists `ovll:theme`.
- Consumes: browser `matchMedia("(prefers-color-scheme: dark)")`; fixture selection controls (temporary, not the source of truth).

- [ ] **Step 1: Write failing tests** for stored dark/light/system selection, OS theme change while system selected, invalid stored preference, storage write/read throwing, double destroy, fixture showing current setting rather than storing it itself.
- [ ] **Step 2: Verify red.** Run: `node --test tests/frontend/theme.test.mjs`. Expected: failures for missing owner/interface.
- [ ] **Step 3: Implement owner and integrate Boot/temporary controls.** Keep `base.css` system fallback. Do not add environment singleton just to expose browser facts: components use `matchMedia`, pointer capabilities and standalone state directly unless cross-consumer duplication is demonstrated.
- [ ] **Step 4: Verify green.** Run same command. Expected: zero failures.
- [ ] **Step 5: Commit** focused owner, fixture integration and tests: `feat(beta): own theme settings separately`.

### Task 3: Server-cache loader boundary (no fabricated backend)

**Files:**
- Create: `front/js/data/cacheLoader.js`
- Modify: `docs/developing/frontend-data.md`
- Test: `tests/frontend/cache-loader.test.mjs`

**Interfaces:**
- Consumes: `createLocalDataStore().cache.read/write`; optional injected `fetchSnapshot({ kind, roomId, itemId, signal })` returning `{value, revision}` or throwing.
- Produces: `createCacheLoader({ cache, fetchSnapshot? })` → `load(kind,roomId,itemId,{ revalidate=false, signal }={})`, `destroy()`. Resolved load result `{entry, status:"cache"|"refreshed"|"missing"|"unavailable"}` (avoid unhandled background work). Do not infer server origin without configured fetcher.

- [ ] **Step 1: Write failing tests** for cache hit/miss, `revalidate:false` never fetching, explicit revalidation with revision advancement, equal/stale revision rejected using existing `write` response, cancellation, network failure surfaced instead of pretending success, same-key concurrent refresh dedupe.
- [ ] **Step 2: Verify red.** Run: `node --test tests/frontend/cache-loader.test.mjs`. Expected: missing interface or red assertions.
- [ ] **Step 3: Implement narrow adapter.** Enforce explicit, validated `revision` on fetched snapshots, forward signal, preserve cache `source:"server"` only for verified fetch results. Handle `destroy` cleanup/in-flight state; no retries until concrete endpoint policy is specified.
- [ ] **Step 4: Verify green.** Run same command. Expected: zero failures. Record existing IndexedDB domain restrictions and no server API.
- [ ] **Step 5: Commit** focused adapter/tests/docs: `feat(beta): expose cache loading and revision guard`.

### Task 4: PWA display/update observation and Boot composition

**Files:**
- Create: `front/js/runtime/appLifecycle.js`
- Modify: `front/js/boot.js`, `docs/developing/frontend-global.md`
- Test: `tests/frontend/app-lifecycle.test.mjs`, `tests/frontend/boot-lifetime.test.mjs`

**Interfaces:**
- Produces: `createAppLifecycle({ windowRef, navigatorRef, getLatestVersion? })` → `getDisplayMode(): "browser"|"standalone"`, `getServiceWorkerState(): "unsupported"|"none"|"installed"|"waiting"`, `checkAppVersion({signal}): Promise<{status:"unknown"|"current"|"update-available",latest?:string}>`, `destroy()`.
- Consumes: read-only `matchMedia("(display-mode: standalone)")`, `navigator.standalone`, existing registration if available, injected version provider only; **no implicit register/update/reload**.

- [ ] **Step 1: Write failing tests** for standalone/browser transitions, absent service worker/controller/registration, waiting worker, no version provider `unknown`, rejected provider leaves error visible, Boot teardown after pagehide, no secondary `currentPage`.
- [ ] **Step 2: Verify red.** Run: `node --test tests/frontend/app-lifecycle.test.mjs tests/frontend/boot-lifetime.test.mjs`. Expected: missing-owner failures.
- [ ] **Step 3: Implement app lifecycle without side effects.** Do not add a service-worker script or invented version URL; install future `getLatestVersion` only when a source exists. Boot creates services and passes their narrow interfaces. Keep `Page Host.getActivePage()` as identity authority.
- [ ] **Step 4: Verify green + regression.** Run: `node --test tests/frontend/*.test.mjs`. Expected: zero failures; Boot, existing menu and Shell listeners remain paired with destruction.
- [ ] **Step 5: Commit** after runtime tests and docs: `feat(beta): observe pwa lifecycle and version availability`.

## Completion and handoff

- Run `node --test tests/frontend/*.test.mjs`, browser manual checks on beta default Workspace at 390×844 and 1280×800, physical Android keyboard where a real device is accessible; label unavailable checks **UNVERIFIED**.
- Confirm `git diff main` has **no modifications** and no deploy config changes. Do not claim cache/server freshness, PWA update-ready, or real IME correctness without genuine sources/device evidence.
- Review whole branch and report any regression/limitations; do not merge into main.
