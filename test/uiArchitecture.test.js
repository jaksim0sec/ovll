import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function compact(value) {
  return String(value)
    .replace(
      /:is\((#[a-z0-9_-]+),\[[^\]]+\]\)/gi,
      "$1"
    )
    .replace(/\s+/g, " ");
}

test("workspace shell owns workspace chrome and library is a sibling page", () => {
  const html = read("front/index.html");
  const shell = html.indexOf('id="workspace-shell"');
  const topbar = html.indexOf('id="topbar"');
  const workspace = html.indexOf('id="workspace"');
  const composer = html.indexOf('id="composer"');
  const shellEnd = html.indexOf("<!-- /workspace-shell -->");
  const library = html.indexOf('id="library-page"');

  assert.ok(shell >= 0, "workspace shell must exist");
  assert.ok(topbar > shell, "topbar must be inside workspace shell");
  assert.ok(workspace > topbar, "workspace must follow topbar");
  assert.ok(composer > workspace, "composer must follow workspace");
  assert.ok(shellEnd > composer, "workspace shell closing marker must follow composer");
  assert.ok(library > shellEnd, "library must be a sibling after workspace shell");
});

test("global stylesheet defines semantic layout and layer tokens", () => {
  const css = read("front/css/style.css");

  for (const token of [
    "--content-rail",
    "--wide-rail",
    "--control-size",
    "--surface-hover",
    "--layer-content",
    "--layer-topbar",
    "--layer-composer",
    "--layer-sidebar",
    "--layer-page",
    "--layer-overlay",
    "--layer-notice"
  ]) {
    assert.match(css, new RegExp(token + "\\s*:"));
  }

  assert.match(
    css,
    /\.ovll-workspace-shell\s*\{[^}]*z-index:\s*var\(--layer-content\)/
  );

  const ui = compact(read("front/css/ui.css"));
  assert.match(
    ui,
    /#mode-switch\s*\{[^}]*height:\s*var\(--control-size\)/
  );
});

test("workspace controls have one consolidated ownership section", () => {
  const css = read("front/css/ui.css");

  for (const legacyHeading of [
    "COMPOSER STABILITY",
    "COMPOSER ATTACH FIX",
    "COMPOSER ATTACH DETAIL",
    "COMPOSER ICON DETAIL",
    "OVLL UI COHESION",
    "OVLL SIMPLE CONTROL SURFACES"
  ]) {
    assert.doesNotMatch(css, new RegExp(legacyHeading));
  }

  assert.match(css, /WORKSPACE CONTROL SYSTEM/);
});

test("topbar has no empty left or right placeholder rails", () => {
  const html = read("front/index.html");
  const ui = compact(read("front/css/ui.css"));

  assert.doesNotMatch(html, /id="topbar-left"/);
  assert.doesNotMatch(html, /id="topbar-right"/);
  assert.doesNotMatch(ui, /#topbar-left|#topbar-right/);
  assert.match(
    ui,
    /#mode-switch\s*\{[^}]*height:\s*var\(--control-size\)/
  );
});

test("workspace control system does not re-patch composer ownership", () => {
  const css = read("front/css/ui.css");
  const start = css.indexOf("WORKSPACE CONTROL SYSTEM");
  const end = css.indexOf("NON-BLOCKING ERROR NOTICE", start);
  const section = css.slice(start, end);

  assert.doesNotMatch(
    section,
    /#composer-(?:form|input|attach|submit)/
  );
  assert.match(
    css,
    /COMPOSER TOUCH TARGETS[\s\S]*?@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)/
  );
});

test("sidebar primary navigation is a single-column peer list", () => {
  const css = compact(read("front/css/shellMenu.css"));

  assert.match(
    css,
    /\.ovll-sidebar-primary\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/
  );
  assert.doesNotMatch(
    css,
    /\.ovll-sidebar-primary-action:first-child\s*\{/
  );
});

test("library is a file index that opens the shared artifact preview", () => {
  const html = read("front/index.html");
  const css = compact(read("front/css/library.css"));
  const js = read("front/js/libraryPage.js");
  const app = read("front/js/app.js");

  assert.doesNotMatch(html, /data-library-count/);
  assert.doesNotMatch(html, /data-library-detail/);
  assert.doesNotMatch(html, /data-library-back/);
  assert.doesNotMatch(css, /\.ovll-library-detail/);
  assert.match(
    css,
    /\.ovll-library-heading h1\s*\{[^}]*font-size:\s*clamp\(1\.45rem,2\.6vw,1\.72rem\)/
  );
  assert.match(js, /action:null/);
  assert.match(js, /global\.AstraApp\s*\?\.previewArtifact/);
  assert.match(app, /previewArtifact:\s*openArtifactPreview/);
});test("global overlays use the semantic layer scale", () => {
  const chatCss = compact(read("front/css/chat.css"));
  const uiCss = compact(read("front/css/ui.css"));

  assert.match(
    chatCss,
    /\.astra-artifact-preview-root\s*\{[^}]*z-index:\s*var\(--layer-overlay\)/
  );
  assert.doesNotMatch(chatCss, /z-index:\s*1200/);
});

test("chat user action states are independent selectors", () => {
  const css = compact(read("front/css/chat.css"));

  assert.doesNotMatch(
    css,
    /\.astra-message-user:hover \.astra-message-user:focus-within/
  );
  assert.match(
    css,
    /\.astra-message-user:hover\s*,\s*\.astra-message-user:focus-within\s*,\s*\.astra-message-user\.is-actions-visible\s*\{/
  );
});

test("library page header is visually below global app navigation", () => {
  const css = compact(read("front/css/library.css"));

  assert.match(
    css,
    /#library-page\s*\{[^}]*--library-chrome-height:\s*calc\(\s*var\(--top-control-top\) \+ 2\.3rem \+ \.9rem\s*\)/
  );
  assert.match(
    css,
    /\.ovll-library-shell\s*\{[^}]*padding:[^}]*calc\(\s*var\(--safe-top\) \+ var\(--library-chrome-height\)/
  );
  assert.doesNotMatch(
    css,
    /\.ovll-library-title-row\s*\{[^}]*padding-left:\s*var\(--library-nav-reserve\)/
  );
});

test("library and shared preview keep keyboard focus discoverable", () => {
  const libraryCss = compact(read("front/css/library.css"));
  const chatCss = compact(read("front/css/chat.css"));
  const app = read("front/js/app.js");

  assert.match(
    libraryCss,
    /\.ovll-library-search:focus-within\s*\{/
  );
  assert.match(
    libraryCss,
    /\.ovll-library-artifact-card:focus-visible\s*\{/
  );
  assert.match(
    chatCss,
    /\.astra-artifact-preview-close\s*,|\.astra-artifact-preview-close:hover/
  );
  assert.match(app, /returnFocus/);
  assert.match(app, /returnFocus\.focus/);
});

test("mobile library remains a compact list under the global chrome", () => {
  const css = compact(read("front/css/library.css"));
  const js = read("front/js/libraryPage.js");

  assert.match(
    css,
    /@media\s*\(max-width:\s*46rem\)[^{]*\{[\s\S]*?\.ovll-library-grid\s*\{[^}]*grid-template-columns:\s*1fr/
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*46rem\)[^{]*\{[\s\S]*?\.ovll-library-heading h1\s*\{[^}]*font-size:\s*1\.5rem/
  );
  assert.doesNotMatch(css, /has-selection/);
  assert.doesNotMatch(js, /selectedId/);
  assert.match(js, /previewFile/);
});

test("composer uses a compact single-row state and a two-row expanded state", () => {
  const css = compact(read("front/css/ui.css"));
  const js = read("front/js/app.js");
  const resizeStart = js.indexOf("function resizeComposer");
  const resizeEnd = js.indexOf("function setBusy", resizeStart);
  const resize = js.slice(resizeStart, resizeEnd);

  assert.match(
    css,
    /#composer-form\s*\{[^}]*width:\s*min\(39rem,\s*calc\(100% - 1\.5rem\)\)[^}]*min-height:\s*3\.25rem[^}]*display:\s*grid[^}]*grid-template-columns:\s*auto\s+minmax\(0,1fr\)\s+auto/
  );
  assert.match(
    css,
    /#composer-form\.is-expanded\s*\{[^}]*grid-template-rows:\s*minmax\(0,auto\)\s+auto/
  );
  assert.match(
    css,
    /#composer-form\.is-expanded\s*#composer-input\s*\{[^}]*grid-column:\s*1\s*\/\s*-1[^}]*grid-row:\s*1/
  );
  assert.match(
    css,
    /#composer-form\.is-expanded\s*#composer-attach\s*\{[^}]*grid-row:\s*2/
  );
  assert.match(
    css,
    /#composer-form\.is-expanded\s*#composer-submit\s*\{[^}]*grid-row:\s*2/
  );
  assert.ok(
    resize.indexOf('classList.remove') <
      resize.indexOf("collapsedHeight"),
    "collapsed width must be measured before expansion"
  );
  assert.ok(
    resize.indexOf("composerForm.classList.toggle") <
      resize.indexOf("getBoundingClientRect"),
    "expanded layout must settle before form height is measured"
  );
  assert.match(
    resize,
    /collapsedHeight[\s\S]*?classList\.toggle[\s\S]*?composerInput\.style\.height\s*=\s*"auto"[\s\S]*?composerInput\.scrollHeight/
  );
});

test("composer autofocus is desktop-only and never summons a mobile keyboard", () => {
  const js = read("front/js/app.js");
  const start = js.indexOf("async function handleSubmit");
  const end = js.indexOf("function handleComposerInput", start);
  const submit = js.slice(start, end);

  assert.match(submit, /composerInput\.blur\(\)/);
  assert.match(submit, /await runPrompt\(text\)/);
  assert.ok(
    submit.indexOf("composerInput.blur()") <
      submit.indexOf("await runPrompt(text)")
  );

  assert.match(
    js,
    /function\s+shouldAutoFocusComposer\s*\([\s\S]*?\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/
  );
  assert.match(
    js,
    /function\s+focusComposerForDesktop\s*\([\s\S]*?UI\.getMode\?\.\(\)[\s\S]*?"chat"[\s\S]*?composerInput\.focus/
  );
  assert.match(
    js,
    /UI\.on\("modechange"[\s\S]*?mode\s*===\s*"chat"[\s\S]*?focusComposerForDesktop/
  );
  assert.match(
    js,
    /state\.ready\s*=\s*true[\s\S]*?focusComposerForDesktop/
  );
});

test("dark theme keeps the app background distinct from surfaces", () => {
  const css = read("front/css/style.css");
  const start = css.indexOf(":root.dark");
  const end = css.indexOf("/* =========================================================", start);
  const dark = css.slice(start, end);

  assert.match(dark, /--bg:\s*#060606/);
  assert.match(dark, /--panel:\s*#171717/);
  assert.match(dark, /--line-strong:\s*rgba\(255, 255, 255, 0\.16\)/);
});

test("library page owns Escape and focus lifecycle", () => {
  const js = read("front/js/libraryPage.js");

  assert.match(js, /returnFocus/);
  assert.match(js, /event\.key\s*!==\s*"Escape"/);
  assert.match(js, /restorePageFocus/);
  assert.match(js, /focusLibraryEntry/);
});

test("microcopy uses a shared readable token", () => {
  const globalCss = read("front/css/style.css");
  const nodeCss = compact(read("front/css/node.css"));
  const libraryCss = compact(read("front/css/library.css"));

  assert.match(globalCss, /--font-micro:\s*\.625rem/);
  assert.match(nodeCss, /\.vc-start-badge\s*\{[^}]*font-size:\s*var\(--font-micro\)/);
  assert.match(libraryCss, /\.ovll-library-artifact-card \.astra-artifact-meta\s*\{[^}]*font-size:\s*var\(--font-micro\)/);
});test("coarse pointers get usable action targets", () => {
  const nodeCss = compact(read("front/css/node.css"));
  const libraryCss = compact(read("front/css/library.css"));
  const chatCss = compact(read("front/css/chat.css"));
  const uiCss = compact(read("front/css/ui.css"));

  assert.match(
    nodeCss,
    /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)[^{]*\{[\s\S]*?\.vc-node-action\s*\{[^}]*width:\s*2\.5rem[^}]*height:\s*2\.5rem/
  );
  assert.match(
    nodeCss,
    /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)[^{]*\{[\s\S]*?\.vc-port-hit\s*\{[^}]*width:\s*2\.5rem[^}]*min-height:\s*2\.5rem/
  );
  assert.match(
    chatCss,
    /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)[^{]*\{[\s\S]*?\.astra-message-action\s*\{[^}]*width:\s*2\.5rem[^}]*height:\s*2\.5rem/
  );
  assert.match(
    uiCss,
    /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)[^{]*\{[\s\S]*?#composer-attach\s*,\s*#composer-submit\s*\{[^}]*width:\s*2\.5rem[^}]*height:\s*2\.5rem/
  );
});

test("sidebar source has no definition-only formatTime helper", () => {
  const js = read("front/js/shellMenu.js");
  assert.doesNotMatch(js, /function\s+formatTime\s*\(/);
});

test("sidebar typography is larger and higher contrast", () => {
  const css = compact(read("front/css/shellMenu.css"));

  assert.match(css, /#ovll-shell-menu-panel\s*\{[^}]*--sidebar-text:/);
  assert.match(css, /\.ovll-sidebar-primary-action\s*\{[^}]*color:\s*var\(--sidebar-text\)[^}]*font-size:\s*1\.01rem/);
  assert.match(css, /\.ovll-sidebar-section-title\s*\{[^}]*font-size:\s*\.86rem/);
  assert.match(css, /\.ovll-sidebar-chat-title\s*\{[^}]*font-size:\s*\.98rem/);
  assert.match(css, /\.ovll-sidebar-chat-menu button\s*\{[^}]*color:\s*var\(--sidebar-text\)[^}]*font-size:\s*\.9rem/);
});

test("light chat bubble follows the workspace background palette", () => {
  const css = read("front/css/chat.css");
  const light = css.match(
    /\.astra-message-user\s*\n\.astra-message-body\s*\{([\s\S]*?)\n\}/
  )?.[1] ?? "";
  const dark = css.match(
    /:root\.dark\s*\n\.astra-message-user\s*\n\.astra-message-body\s*\{([\s\S]*?)\n\}/
  )?.[1] ?? "";

  assert.match(light, /var\(--bg\)\s+48%/);
  assert.match(light, /var\(--panel\)\s+52%/);
  assert.doesNotMatch(light, /var\(--text\)\s+6%/);
  assert.match(dark, /var\(--panel\)\s+94%/);
  assert.match(dark, /var\(--text\)\s+6%/);
});

test("workspace hierarchy favors content over decorative surfaces", () => {
  const shell = compact(read("front/css/shellMenu.css"));
  const chat = compact(read("front/css/chat.css"));
  const ui = compact(read("front/css/ui.css"));
  const html = read("front/index.html");

  assert.match(shell, /\.ovll-sidebar-primary-action\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/);
  assert.match(shell, /@media\s*\(max-width:\s*43\.75rem\)[^{]*\{[\s\S]*?--sidebar-width:[^;]*82vw/);
  assert.match(chat, /#chat-messages\s*\{[^}]*width:\s*min\(42\.5rem,\s*100%\)/);
  assert.match(chat, /\.astra-message-user\s*\.astra-message-body\s*\{[^}]*border:\s*0[^}]*font-size:\s*\.98rem/);
  assert.match(chat, /\.astra-message-assistant\s*\.astra-message-body\s*\{[^}]*max-width:\s*42\.5rem[^}]*font-size:\s*1\.06rem/);
  assert.match(ui, /#composer-form\s*\{[^}]*width:\s*min\(39rem,\s*calc\(100% - 1\.5rem\)\)[^}]*min-height:\s*3\.25rem/);
  assert.match(ui, /#composer-input\s*\{[^}]*font-size:\s*\.93rem/);
  assert.match(html, /name="theme-color"[^>]*content="#060606"/s);
});

test("settled workspace clips inactive page compositing artifacts", () => {
  const style = compact(read("front/css/style.css"));
  const ui = compact(read("front/css/ui.css"));
  const js = read("front/js/workspaceUi.js");

  assert.match(style, /#app-stage\s*\{[^}]*overflow:\s*hidden[^}]*isolation:\s*isolate/);
  assert.match(ui, /#workspace\s*\{[^}]*overflow:\s*hidden[^}]*isolation:\s*isolate/);
  assert.match(ui, /#workspace\s*>\s*\.page\s*\{[^}]*contain:\s*layout paint[^}]*backface-visibility:\s*hidden/);
  assert.match(ui, /#workspace\.is-dragging\s*>\s*\.page\s*\{[^}]*will-change:/);
  assert.match(ui, /#workspace\[data-mode="chat"\]:not\(\.is-dragging\)[\s\S]*?#canvas-page[\s\S]*?visibility:\s*hidden/);
  assert.match(js, /chatPage\.setAttribute\([\s\S]*?"aria-hidden"/);
  assert.match(js, /canvasPage\.setAttribute\([\s\S]*?"aria-hidden"/);
  assert.match(js, /dark\s*\?\s*"#060606"/);
});

test("repository no longer exposes the obsolete root Astra frontend", () => {
  for (const name of [
    "index.html",
    "style.css",
    "functions.js",
    "pageUI.js",
    "canvas.js",
    "workflow.js",
    "scheduler.js",
    "executor.js",
    "manifest.json"
  ]) {
    assert.equal(
      fs.existsSync(path.join(ROOT, name)),
      false,
      name + " is obsolete root frontend source"
    );
  }
});

test("project metadata names ovll and ignores ad-hoc backups", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  const readme = read("README.md");
  const gitignore = read(".gitignore");

  assert.equal(pkg.name, "ovll");
  assert.equal(lock.name, "ovll");
  assert.equal(lock.packages[""].name, "ovll");
  assert.match(readme, /^# ovll\b/m);
  assert.match(gitignore, /^\*\.bak$/m);
  assert.match(gitignore, /^\*\.astra-bak$/m);
});

test("adjacent source backups are not tracked beside live files", () => {
  for (const relativeDir of ["front/css", "front/js"]) {
    const names = fs.readdirSync(path.join(ROOT, relativeDir));
    const backups = names.filter(name => /(?:\.bak|\.astra-bak)$/.test(name));
    assert.deepEqual(backups, [], relativeDir + " contains duplicate backups: " + backups.join(", "));
  }

  for (const name of [
    "server.js.bak",
    "server.js.astra-bak",
    "server.js.astra-before-memory-rework"
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, name)), false, name + " should not be tracked");
  }
});


test("runtime finalization policy is booted before app and precached", () => {
  const boot=read("front/js/boot.js"),sw=read("front/sw.js"),app=read("front/js/app.js");
  assert.match(boot,/ovllPointerLocalActions\.js/);
  assert.match(sw,/ovllPointerLocalActions\.js/);
  assert.match(app,/PointerAPI\.localResponse/);
  assert.doesNotMatch(boot,/runtimeFinalization\.js/);
});

test("preview engine uses format-aware sources and keeps HTML sandbox opaque", () => {
  const source =
    read(
      "front/js/previewSandbox.js"
    );

  assert.match(
    source,
    /artifact\?\.previewKind/
  );
  assert.match(
    source,
    /sandbox[\s\S]{0,160}allow-scripts/
  );
  assert.doesNotMatch(
    source,
    /allow-same-origin/
  );
  assert.match(
    source,
    /connect-src 'none'/
  );
  assert.match(
    source,
    /frame-src 'none'/
  );
  assert.match(
    source,
    /object-src 'none'/
  );
  assert.match(
    source,
    /function\s+htmlSource\s*\(/
  );
  assert.match(
    source,
    /function\s+semanticText\s*\(/
  );
  assert.match(
    source,
    /function\s+isBinaryOffice\s*\(/
  );
});

test("PDF preview loads eagerly with a normalized PDF MIME", () => {
  const source =
    read(
      "front/js/previewSandbox.js"
    );

  assert.match(
    source,
    /kind==="pdf"[\s\S]*loading",[\s\S]*"eager"/
  );
  assert.match(
    source,
    /application\/pdf/
  );
  assert.match(
    source,
    /blob\.slice\([\s\S]*normalizedMime/
  );
});

test("Pointer canvas execution persists a run and shows its result in chat",()=>{
  const app=read("front/js/app.js"),local=read("front/js/ovllPointerLocal.js");
  assert.match(app,/async function runPointerCanvasNode/);
  assert.match(app,/addAssistantMessage\(\(run\.status/);
  assert.match(app,/runLocalNodes\(\{targets:\[nodeId\]/);
  assert.match(local,/workspaceStore\.updateConversationPointerRuns/);
  assert.doesNotMatch(app,/addUserMessage\(\s*runUserText\s*\)/);
});

test("new chat waiting state uses neutral polite copy only", () => {
  const presence =
    read(
      "front/js/workspacePresence.js"
    );
  const css =
    read(
      "front/css/chat.css"
    );

  assert.match(
    presence,
    /안녕하세요\. 무엇을 도와드릴까요\?/
  );
  assert.match(
    presence,
    /function\s+showStart\s*\(/
  );
  assert.match(
    presence,
    /resetConversation[\s\S]*if\(started\)[\s\S]*beginConversation\(\)[\s\S]*else[\s\S]*showStart\(\)/
  );
  assert.doesNotMatch(
    presence,
    /startViewData|ovll-chat-start-suggestion|WorkspaceStore/
  );
  assert.match(
    css,
    /ovll-chat-start-greeting/
  );
});

test("Groq planner honors one short rate-limit delay", () => {
  const provider=read("backend/ovllPointer/providers.js");
  assert.match(provider,/readRetryAfter/);
  assert.match(provider,/retryAfterSeconds <= 8/);
  assert.match(provider,/waitForRetry/);
  assert.match(provider,/PROVIDER_RATE_LIMIT/);
});

test("server health preserves event-loop stall history", () => {
  const server =
    read(
      "server.js"
    );
  const page =
    read(
      "front/log.html"
    );

  assert.match(
    server,
    /maxEventLoopLagMs/
  );
  assert.match(
    server,
    /severeLagCount/
  );
  assert.match(
    server,
    /lastSevereLagAt/
  );
  assert.match(
    page,
    /max lag/
  );
  assert.match(
    page,
    /stall/
  );
});

test("PDFKit fallback uses one font subset and a low-CPU single-pass profile", () => {
  const renderer =
    read(
      "backend/artifacts/pdfKitRenderer.js"
    );

  assert.match(
    renderer,
    /registerFont\(\s*"NotoKR"/
  );
  assert.doesNotMatch(
    renderer,
    /NotoKRMedium|NotoKRBold/
  );
  assert.match(
    renderer,
    /bufferPages:\s*false/
  );
  assert.match(
    renderer,
    /compress:\s*false/
  );
  assert.doesNotMatch(
    renderer,
    /bufferedPageRange\(/
  );
});

test("PDFKit fallback reuses one isolated worker instead of cold-starting every PDF", () => {
  const renderer =
    read(
      "backend/artifacts/pdfRenderer.js"
    );
  const worker =
    read(
      "backend/artifacts/pdfKitWorker.js"
    );
  const artifact =
    read(
      "backend/artifacts/artifactStore.js"
    );

  assert.match(
    renderer,
    /sharedPdfKitWorker/
  );
  assert.match(
    renderer,
    /ensurePdfKitWorker/
  );
  assert.match(
    renderer,
    /pdfKitWorker\.js/
  );
  assert.match(
    worker,
    /parentPort\.on/
  );
  assert.doesNotMatch(
    worker,
    /parentPort\.close\(/
  );
  assert.doesNotMatch(
    artifact,
    /withArtifactTimeout\([\s\S]*renderPdfFallback/
  );
});

test("log API exposes lightweight server runtime health", () => {
  const server =
    read(
      "server.js"
    );
  const page =
    read(
      "front/log.html"
    );

  assert.match(
    server,
    /BOOT_ID/
  );
  assert.match(
    server,
    /process\.memoryUsage\(\)/
  );
  assert.match(
    server,
    /eventLoopLagMs/
  );
  assert.match(
    server,
    /recentRestart/
  );
  assert.match(
    page,
    /RSS/
  );
  assert.match(
    page,
    /heap/
  );
  assert.match(
    page,
    /event loop/
  );
});

test("Pointer health remains available without exposing retired model logs",()=>{
  const server=read("server.js"),page=read("front/log.html");
  assert.match(server,/\/api\/logs/);
  assert.match(server,/serverRuntimeHealth\(\)/);
  assert.doesNotMatch(server,/geminiRequestLogs|pushGeminiRequestLog/);
  assert.match(page,/\/api\/logs/);
  assert.doesNotMatch(page,/GEMINI_API_KEY/);
});
test("bootstrap fetches app scripts concurrently while preserving ordered execution", () => {
  const boot =
    read(
      "front/js/boot.js"
    );

  assert.match(
    boot,
    /Promise\.all\(\s*APP_SCRIPTS[\s\S]*map\(\s*loadScript/
  );
  assert.doesNotMatch(
    boot,
    /for\s*\(\s*const\s+src\s+of\s+APP_SCRIPTS\s*\)[\s\S]*await\s+loadScript/
  );
});

test("server version check cannot hold first-load indefinitely", () => {
  const boot =
    read(
      "front/js/boot.js"
    );

  assert.match(
    boot,
    /AbortController/
  );
  assert.match(
    boot,
    /VERSION_CHECK_TIMEOUT/
  );
});

test("first-load mark is deliberately larger but remains minimal", () => {
  const html =
    read(
      "front/index.html"
    );

  assert.match(
    html,
    /\.ovll-boot-orb\s*\{[\s\S]*width:\s*3\.1rem;[\s\S]*height:\s*3\.1rem;/
  );
  assert.match(
    html,
    /ovll-boot-mark-in/
  );
  assert.doesNotMatch(
    html,
    /ovll-boot-status/
  );
});

test("first-load splash keeps only minimal brand loading information", () => {
  const html =
    read(
      "front/index.html"
    );

  assert.match(
    html,
    /ovll-boot-orb/
  );
  assert.match(
    html,
    /ovll-boot-wordmark/
  );
  assert.match(
    html,
    /ovll-boot-progress/
  );
  assert.doesNotMatch(
    html,
    /class="ovll-boot-status"/
  );
});

test("artifact requests and local persistence are time bounded", () => {
  const api =
    read(
      "front/js/api.js"
    );
  const store =
    read(
      "front/js/fileStore.js"
    );

  assert.match(
    api,
    /ARTIFACT_TIMEOUT/
  );
  assert.match(
    api,
    /330000/
  );
  assert.match(
    api,
    /60000/
  );
  assert.match(
    store,
    /LOCAL_FILE_TIMEOUT/
  );
  assert.match(
    store,
    /15000/
  );
});

test("PDF client timeout remains above the server worker ceiling", () => {
  const renderer =
    read(
      "backend/artifacts/pdfRenderer.js"
    );
  const artifact =
    read(
      "backend/artifacts/artifactStore.js"
    );
  const api =
    read(
      "front/js/api.js"
    );

  assert.match(
    renderer,
    /OVLL_PDFKIT_WORKER_TIMEOUT_MS/
  );
  assert.match(
    renderer,
    /DEFAULT_PDFKIT_TIMEOUT_MS\s*=\s*180000/
  );
  assert.match(
    renderer,
    /MAX_PDFKIT_TIMEOUT_MS\s*=\s*300000/
  );
  assert.match(
    renderer,
    /pdfKitTimeoutMs\s*\(/
  );

  const clientTimeout =
    Number(
      api.match(
        /format === "PDF"[\s\S]*?\?\s*(\d+)/
      )?.[1]
    );
  const serverCeiling =
    Number(
      renderer.match(
        /MAX_PDFKIT_TIMEOUT_MS\s*=\s*(\d+)/
      )?.[1]
    );

  assert.equal(
    clientTimeout,
    330000
  );
  assert.equal(
    serverCeiling,
    300000
  );
  assert.ok(
    clientTimeout >
      serverCeiling
  );
  assert.doesNotMatch(
    artifact,
    /PDF_RENDER_TIMEOUT/
  );
});

test("node definitions survive temporary server unavailability", () => {
  const api =
    read(
      "front/js/api.js"
    );

  assert.match(
    api,
    /ovll:node-definitions/
  );
  assert.match(
    api,
    /using local cache/
  );
});

test("binary office preview path does not decode local blobs as text", () => {
  const source =
    read(
      "front/js/previewSandbox.js"
    );

  const start =
    source.indexOf(
      "function semanticText"
    );
  const end =
    source.indexOf(
      "function parseDelimitedRows",
      start
    );
  const semantic =
    source.slice(
      start,
      end
    );

  assert.match(
    semantic,
    /isBinaryOffice/
  );
  assert.match(
    semantic,
    /previewText/
  );

  const officeBranch =
    semantic.slice(
      semantic.indexOf(
        "isBinaryOffice"
      ),
      semantic.indexOf(
        "const blob"
      )
    );

  assert.doesNotMatch(
    officeBranch,
    /blob\.text\s*\(/
  );
});

test("HTML preview reads actual artifact bytes before previewText fallback", () => {
  const source =
    read(
      "front/js/previewSandbox.js"
    );

  const start =
    source.indexOf(
      "async function htmlSource"
    );
  const end =
    source.indexOf(
      "async function semanticText",
      start
    );
  const htmlSource =
    source.slice(
      start,
      end
    );

  const local =
    htmlSource.indexOf(
      "localBlob"
    );
  const remote =
    htmlSource.indexOf(
      "fetchText"
    );
  const fallback =
    htmlSource.indexOf(
      "previewText"
    );

  assert.ok(
    local >= 0 &&
    remote > local &&
    fallback > remote
  );
});


test("local artifact persistence keeps renderer and preview capability metadata", () => {
  const store =
    read(
      "front/js/fileStore.js"
    );
  const app =
    read(
      "front/js/app.js"
    );

  assert.match(
    store,
    /previewKind/
  );
  assert.match(
    store,
    /renderer/
  );
  assert.match(
    store,
    /targetPages/
  );
  assert.match(
    store,
    /format/
  );
  assert.match(
    app,
    /previewKind:\s*artifact\.previewKind/
  );
  assert.match(
    app,
    /renderer:\s*artifact\.renderer/
  );
  assert.match(
    app,
    /format:\s*artifact\.format/
  );
});


test("artifact preview surface is styled by resolved preview kind", () => {
  const app =
    read(
      "front/js/app.js"
    );
  const css =
    read(
      "front/css/chat.css"
    );

  assert.match(
    app,
    /dataset\.previewKind/
  );
  assert.match(
    app,
    /PreviewEngine\s*\.kind/
  );
  assert.match(
    css,
    /data-preview-kind="pdf"/
  );
  assert.match(
    css,
    /data-preview-kind="html"/
  );
  assert.match(
    css,
    /100dvh/
  );
  assert.match(
    css,
    /\.astra-artifact-preview-body\.is-spreadsheet/
  );
});


test("artifact page targets survive Pointer export through the artifact API",()=>{
  const policy=read("front/js/artifactRequest.js");
  const local=read("front/js/ovllPointerLocal.js");
  const api=read("front/js/api.js"),server=read("server.js");
  const boot=read("front/js/boot.js"),sw=read("front/sw.js");
  assert.match(policy,/targetPages/);
  assert.match(policy,/페이지|쪽/);
  assert.match(policy,/A4/);
  assert.match(local,/resolveArtifactRequest\(\{request:/);
  assert.match(local,/createArtifact\(\{\.\.\.params,sources\}/);
  assert.match(api,/targetPages:\s*input\?\.targetPages/);
  assert.match(server,/targetPages:\s*req\.body\?\.targetPages/);
  assert.ok(boot.indexOf("./js/artifactRequest.js")<boot.indexOf("./js/app.js"));
  assert.match(sw,/\/js\/artifactRequest\.js/);
});

test("planner keeps document length requirements on the upstream writer", () => {
  const core=read("instructions/prompts/core.md");
  const run=read("instructions/prompts/layers/run.md");
  const contract=read("backend/ovllPointer/modelContract.js");
  assert.match(core,/negations, quantities, audience, format/);
  assert.match(run,/Perform the declared intellectual task/);
  assert.match(contract,/artifact\.create exports connected finished contents/);
});

test("PDFKit fallback keeps flowing text cheap and table rows anchored", () => {
  const renderer =
    read(
      "backend/artifacts/pdfKitRenderer.js"
    );

  const paragraphStart =
    renderer.indexOf(
      "function drawParagraph"
    );
  const listStart =
    renderer.indexOf(
      "function drawList",
      paragraphStart
    );
  const quoteStart =
    renderer.indexOf(
      "function drawQuote",
      listStart
    );
  const tableRowStart =
    renderer.indexOf(
      "function drawTableRow"
    );
  const tableStart =
    renderer.indexOf(
      "function drawTable",
      tableRowStart + 1
    );

  const paragraph =
    renderer.slice(
      paragraphStart,
      listStart
    );
  const list =
    renderer.slice(
      listStart,
      quoteStart
    );
  const tableRow =
    renderer.slice(
      tableRowStart,
      tableStart
    );

  assert.ok(
    paragraphStart >= 0 &&
    listStart > paragraphStart &&
    quoteStart > listStart &&
    tableRowStart >= 0 &&
    tableStart > tableRowStart
  );

  assert.doesNotMatch(
    paragraph,
    /textHeight\s*\(/
  );
  assert.doesNotMatch(
    list,
    /textHeight\s*\(/
  );
  assert.match(
    renderer,
    /TEXT_HEIGHT_CACHE_LIMIT/
  );
  assert.match(
    tableRow,
    /ensureSpace[\s\S]*const y\s*=\s*doc\.y/
  );
  assert.match(
    tableRow,
    /doc\.rect\(\s*cellX,\s*y,/
  );
  assert.match(
    tableRow,
    /y \+ 8/
  );
  assert.match(
    renderer,
    /measuredHeight:\s*rowHeight/
  );
});


test("desktop sidebar is a docked interactive layout while mobile keeps overlay behavior", () => {
  const js = read("front/js/shellMenu.js");
  const css = compact(read("front/css/shellMenu.css"));
  const style = compact(read("front/css/style.css"));
  const library = compact(read("front/css/library.css"));
  const ui = read("front/js/workspaceUi.js");

  assert.match(
    js,
    /desktopSidebarMedia\s*=\s*[\s\S]*?min-width:\s*43\.76rem[\s\S]*?hover:\s*hover[\s\S]*?pointer:\s*fine/
  );
  assert.match(js, /function\s+usesDockedSidebar\s*\(/);
  assert.match(
    js,
    /if\(usesDockedSidebar\(\)\)\{\s*setOpen\(true\);\s*\}/
  );
  assert.match(
    css,
    /@media\s*\(min-width:\s*43\.76rem\)\s*and\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)[\s\S]*?#ovll-shell-menu-backdrop\s*\{[^}]*display:\s*none/
  );
  assert.match(
    css,
    /:root\.shell-menu-open\s*#workspace-shell\s*,\s*:root\.shell-menu-open\s*#library-page\s*\{[^}]*left:\s*var\(--sidebar-width\)/
  );
  assert.match(css, /\.ovll-sidebar-dock-toggle\s*\{[^}]*display:\s*none/);
  assert.match(
    css,
    /@media\s*\(min-width:\s*43\.76rem\)[\s\S]*?\.ovll-sidebar-dock-toggle\s*\{[^}]*display:\s*grid/
  );
  assert.match(js, /data-sidebar-action="close"/);
  assert.match(
    js,
    /function\s+beginGesturePoint[\s\S]*?usesDockedSidebar\(\)[\s\S]*?return false/
  );
  assert.match(
    js,
    /listen\(\s*backdrop[\s\S]*?!usesDockedSidebar\(\)[\s\S]*?close\(\)/
  );
  assert.match(
    js,
    /if\(action==="library"\)[\s\S]*?if\(!usesDockedSidebar\(\)\)\{\s*close/
  );
  assert.match(style, /\.ovll-workspace-shell\s*\{[^}]*transition:\s*left\s+\.28s/);
  assert.match(library, /#library-page\s*\{[^}]*transition:\s*left\s+\.28s/);
  assert.match(ui, /workspace\.clientWidth/);
  assert.match(ui, /new global\.ResizeObserver\([\s\S]*?scheduleViewportSync/);
});

test("mouse mode-switch click keeps its button target while drag still captures", () => {
  const js = read("front/js/workspaceUi.js");
  const begin = js.slice(
    js.indexOf("function beginPillGesture"),
    js.indexOf("function updatePillGesture")
  );
  const update = js.slice(
    js.indexOf("function updatePillGesture"),
    js.indexOf("function finishPillGesture")
  );

  assert.match(
    begin,
    /event\.pointerType\s*!==\s*"mouse"[\s\S]*?setPointerCapture/
  );
  assert.match(
    update,
    /pillGesture\.moved\s*=\s*true;[\s\S]*?event\.pointerType\s*===\s*"mouse"[\s\S]*?setPointerCapture/
  );
});


test("desktop root type is slightly smaller without shrinking mobile type", () => {
  const css = compact(read("front/css/style.css"));

  assert.match(css, /html\s*\{[^}]*font-size:\s*16\.75px/);
  assert.match(
    css,
    /@media\s*\(max-width:\s*43\.75rem\)[^{]*\{[\s\S]*?html\s*\{[^}]*font-size:\s*16\.25px/
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*26\.25rem\)[^{]*\{[\s\S]*?html\s*\{[^}]*font-size:\s*15\.75px/
  );
});


test("composer send control has a smaller desktop circle with a fuller arrow", () => {
  const css = compact(read("front/css/ui.css"));

  assert.match(
    css,
    /#composer-submit\s*\{[^}]*width:\s*2\.2rem[^}]*height:\s*2\.2rem[^}]*min-width:\s*2\.2rem[^}]*min-height:\s*2\.2rem/
  );
  assert.match(
    css,
    /#composer-submit svg\s*\{[^}]*width:\s*1\.16rem[^}]*height:\s*1\.16rem[^}]*stroke-width:\s*1\.65/
  );
  assert.match(
    css,
    /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)[^{]*\{[\s\S]*?#composer-attach\s*,\s*#composer-submit\s*\{[^}]*width:\s*2\.5rem[^}]*height:\s*2\.5rem/
  );
});

test("sidebar library icon is a dedicated rounded folder glyph", () => {
  const js = read("front/js/shellMenu.js");

  assert.doesNotMatch(js, /const\s+ArtifactVisuals\s*=/);
  assert.match(
    js,
    /library:\s*`[\s\S]*?<svg[\s\S]*?<path[\s\S]*?stroke-linecap="round"[\s\S]*?stroke-linejoin="round"/
  );
  assert.match(js, /a1\.8 1\.8 0 0 1/);
});


test("motion system uses shared timing tokens and avoids page blur", () => {
  const globalCss = read("front/css/style.css");
  const uiCss = read("front/css/ui.css");
  const sidebarCss = read("front/css/shellMenu.css");

  for (const token of [
    "--motion-ease-standard",
    "--motion-ease-emphasized",
    "--motion-fast",
    "--motion-medium",
    "--motion-slow"
  ]) {
    assert.match(
      globalCss,
      new RegExp(token + "\\s*:")
    );
  }

  assert.doesNotMatch(
    uiCss,
    /#chat-page\s*\{[^}]*filter\s*:/s
  );
  assert.doesNotMatch(
    uiCss,
    /#canvas-page\s*\{[^}]*filter\s*:/s
  );
});

test("runtime UI never renders raw successful model reports", () => {
  const app = read("front/js/app.js");
  const canvas = read("front/js/canvasNode.js");

  assert.doesNotMatch(
    app,
    /completeRuntimeStep\(\s*event\.nodeId,\s*\{\s*detail:\s*event\.report/s
  );
  assert.match(
    canvas,
    /function\s+compactRuntimeReport\s*\(/
  );
  assert.match(
    canvas,
    /raw\.length\s*>\s*max/
  );
});


test("chat markup renders markdown tables including bold-wrapped Gemini rows", () => {
  const app =
    read(
      "front/js/app.js"
    );
  const css =
    read(
      "front/css/chat.css"
    );

  assert.match(
    app,
    /function\s+normalizeChatTableLine\s*\(/
  );
  assert.match(
    app,
    /function\s+chatTableAlignments\s*\(/
  );
  assert.match(
    app,
    /function\s+renderChatTable\s*\(/
  );
  assert.match(
    app,
    /line\.startsWith\("\*\*\|"\)[\s\S]*line\.endsWith\("\|\*\*"\)/
  );
  assert.match(
    app,
    /astra-chat-table-wrap/
  );
  assert.match(
    css,
    /\.astra-chat-table-wrap\s*\{[\s\S]*overflow-x:\s*auto/
  );
  assert.match(
    css,
    /\.astra-chat-table\s*\{[\s\S]*min-width:\s*30rem/
  );
});


test("ordinary conversation uses Pointer messaging and preserves conversation memory",()=>{
  const app=read("front/js/app.js"),api=read("front/js/ovllPointerApi.js");
  const store=read("front/js/workspaceStore.js");
  assert.match(app,/function\s+recentAiConversation\s*\(/);
  assert.match(app,/history:contextHistory/);
  assert.match(app,/request:context=>PointerAPI\.localTurn/);
  assert.match(app,/actions\.coordinate\(/);
  assert.match(app,/addAssistantMessage\(reply\)/);
  assert.match(api,/local\/turn/);
  assert.match(store,/workflowUserRequest:/);
  assert.match(store,/SCHEMA_VERSION\s*=\s*8/);
});

test("chat controls share one rounded SVG language", () => {
  const svg =
    read(
      "front/js/svgLibrary.js"
    );
  const css =
    compact(
      read(
        "front/css/chat.css"
      )
    );

  assert.match(
    svg,
    /messageCopy:[\s\S]*?<rect x="6\.35" y="6\.35"[\s\S]*?rx="2\.45"/
  );
  assert.match(
    svg,
    /messageRetry:[\s\S]*?M15\.45 7\.35A5\.75/
  );
  assert.match(
    svg,
    /composerSend:[\s\S]*?M10 15V5\.35[\s\S]*?m6\.35 9 3\.65-3\.65L13\.65 9/
  );
  assert.match(
    css,
    /\.astra-message-action\s*\{[^}]*border-radius:\s*\.52rem/
  );
  assert.match(
    css,
    /\.astra-message-action:hover\s*\{[^}]*background:/
  );
});

test("chat markup recognizes lightweight inline math without touching inline code", () => {
  const app =
    read(
      "front/js/app.js"
    );
  const css =
    read(
      "front/css/chat.css"
    );

  assert.match(
    app,
    /function\s+renderChatMathExpression\s*\(/
  );
  assert.match(
    app,
    /<sub>\$1<\/sub>/
  );
  assert.match(
    app,
    /<sup>\$1<\/sup>/
  );
  assert.match(
    app,
    /@@OVLL_MATH_/
  );
  assert.ok(
    app.indexOf(
      "const inlineCode = []"
    ) <
    app.indexOf(
      "const protectMath"
    )
  );
  assert.match(
    css,
    /\.astra-inline-math\s*\{/
  );
});


test("Pointer execution uses the deterministic target and dam-mode plan",()=>{
  const app=read("front/js/app.js"),local=read("front/js/ovllPointerLocal.js");
  const plan=read("front/js/ovllPointerPlanCore.mjs");
  assert.match(local,/buildExecutionPlan\(snapshot,/);
  assert.match(local,/targets:targetIds,damMode/);
  assert.match(app,/runLocalNodes\(\{targets,damMode:/);
  assert.match(plan,/buildExecutionPlan/);
});

test("Pointer action execution does not create a second user message",()=>{
  const app=read("front/js/app.js");
  const start=app.indexOf("async function runLocalPrompt(");
  const end=app.indexOf("async function runPointerPrompt(",start);
  const body=app.slice(start,end);
  assert.match(body,/options\.addUserMessage!==false/);
  assert.match(body,/addUserMessage\(value\)/);
  assert.match(body,/handlers:\s*\{/);
  assert.match(body,/['"]run\.start['"]:async/);
  assert.equal((body.match(/addUserMessage\(value\)/g)||[]).length,1);
});

test("moderate workflow execution is confirmable directly from chat", () => {
  const app=read("front/js/app.js"),actions=read("front/js/ovllPointerLocalActions.js");
  assert.match(app,/['"]ir\.applyPatch['"]:async/);
  assert.match(app,/['"]run\.start['"]:async/);
  assert.match(actions,/dependsOn/);
  assert.match(actions,/LOCAL_ACTION_DEPENDENCY_FAILED/);
});

test("explicit verification requests are promoted to workflow planning", () => {
  const entry=read("instructions/prompts/layers/entry.md");
  const core=read("instructions/prompts/core.md");
  assert.match(entry,/Interpret everyday language by the requested outcome/);
  assert.match(core,/Preserve the current request/);
  assert.match(entry,/Combine communication, IR construction, execution and functionization/);
});

test("chat routing owns workflow decisions before planner execution", () => {
  const host=read("backend/ovllPointer/localHost.js"),app=read("front/js/app.js");
  assert.match(host,/['"]layer\.entry['"],['"]layer\.chat['"],['"]layer\.ir['"]/);
  assert.match(app,/PointerAPI\.localTurn/);
  assert.doesNotMatch(app,/API\.planWorkflow/);
});

test("Pointer can apply a patch and execute a target in one proposal",()=>{
  const app=read("front/js/app.js");
  const entry=read("instructions/prompts/layers/entry.md");
  assert.match(app,/onActionStart:pointerActionStarted/);
  assert.match(app,/['"]run\.start['"]:async/);
  assert.match(app,/runLocalNodes\(\{targets/);
  assert.match(entry,/Combine communication, IR construction, execution and functionization/);
});
test("Pointer execution scope follows targets and dam mode",()=>{
  const local=read("front/js/ovllPointerLocal.js");
  assert.match(local,/buildExecutionPlan\(snapshot,/);
  assert.match(local,/damMode='closed'/);
  assert.match(local,/targets:targetIds,damMode/);
});
test("Pointer node tasks receive the actual request and constraints",()=>{
  const local=read("front/js/ovllPointerLocal.js");
  const host=read("backend/ovllPointer/localHost.js");
  assert.match(local,/requestText:objective,taskConstraints,signal/);
  assert.match(host,/context\.constraints=taskConstraints/);
  assert.match(host,/modules:\['run\.perform'\]/);
});
test("custom nodes use the canvas plugin pipeline and node picker catalog", () => {
  const canvas = read("front/js/canvasNode.js");
  const custom = read("front/js/customNodes.js");
  const app = read("front/js/app.js");
  const builder = read("front/js/canvasNodeBuilder.js");
  const css = compact(read("front/css/ui.css"));

  assert.match(
    canvas,
    /global\.OvllCanvasPlugins/
  );
  assert.match(
    canvas,
    /prepareRuntime/
  );
  assert.match(
    custom,
    /CanvasPlugins\.register/
  );
  assert.match(
    custom,
    /group:"custom"/
  );
  assert.doesNotMatch(
    app,
    /CustomNodes\.expandWorkflow/
  );
  assert.match(
    builder,
    /canvas-node-builder-group/
  );
  assert.match(
    app,
    /\.mountNodeBuilder\(/
  );
  assert.match(
    css,
    /\.canvas-node-builder-options\s*\{[^}]*display:\s*grid/
  );
});



test("runtime activity uses ovll naming and keeps a definite chat width", () => {
  const chat = compact(read("front/css/chat.css"));
  const app = read("front/js/app.js");

  assert.doesNotMatch(chat, /\.astra-runtime-/);
  assert.doesNotMatch(app, /astra-runtime-/);
  assert.match(
    chat,
    /\.ovll-runtime-activity\s*\{[^}]*width:\s*100%[^}]*max-width:\s*42\.5rem/
  );
  assert.match(
    chat,
    /\.ovll-runtime-activity-body\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*max-width:\s*100%/
  );
  assert.match(
    chat,
    /\.ovll-runtime-step\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/
  );
  assert.match(
    chat,
    /\.ovll-runtime-step-content\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/
  );
});


test("node ports are softly interactive and visually tucked behind the node shell", () => {
  const css =
    compact(
      read("front/css/node.css")
    );

  assert.match(
    css,
    /\.vc-node\s*\{[^}]*isolation:\s*isolate/
  );
  assert.match(
    css,
    /\.vc-node::before\s*\{[^}]*z-index:\s*1[^}]*border-color:\s*inherit[^}]*background:\s*var\(--node\)[^}]*pointer-events:\s*none/
  );
  assert.match(
    css,
    /\.vc-node-head\s*,\s*\.vc-node-body\s*,\s*\.vc-node-footer\s*\{[^}]*z-index:\s*2/
  );
  assert.match(
    css,
    /\.vc-port-hit\s*\{[^}]*z-index:\s*0/
  );
  assert.doesNotMatch(
    css,
    /\.vc-port-hit\.vc-(?:input|output) \.vc-port-pill\s*\{[^}]*clip-path/
  );
  assert.match(
    css,
    /\.vc-port-pill\s*\{[^}]*width:\s*\.75rem[^}]*height:\s*\.75rem[^}]*transform\s+\.28s\s+cubic-bezier\(\.22,\.72,\.18,1\)/
  );
  assert.match(
    css,
    /\.vc-port-hit:hover \.vc-port-pill\s*\{[^}]*transform:\s*scale\(1\.09\)[^}]*background:\s*color-mix/
  );
  assert.doesNotMatch(
    css,
    /@keyframes\s+vc-port-pickup-hold/
  );
});

test("node connection handles stay hollow while title controls gain hierarchy", () => {
  const css =
    compact(
      read("front/css/node.css")
    );

  assert.match(
    css,
    /\.vc-port-pill\s*\{[^}]*box-sizing:\s*border-box[^}]*border:[^}]*\.0625rem solid[^}]*background:\s*var\(--node\)/
  );
  assert.doesNotMatch(
    css,
    /\.vc-port-pill\.vc-connected/
  );
  assert.match(
    css,
    /\.vc-node-icon\s*\{[^}]*width:\s*1\.75rem[^}]*flex:\s*0 0 1\.75rem/
  );
  assert.match(
    css,
    /\.vc-node-icon svg\s*\{[^}]*width:\s*1\.455rem[^}]*height:\s*1\.455rem[^}]*stroke-width:\s*1\.152/
  );
  assert.match(
    css,
    /\.vc-node-icon svg \[stroke\]\s*\{[^}]*stroke-width:\s*1\.152/
  );
  assert.match(
    css,
    /\.vc-node-title\s*\{[^}]*font-weight:\s*630/
  );
  assert.match(
    css,
    /\.vc-file-title\s*\{[^}]*font-weight:\s*630/
  );
  assert.match(
    css,
    /\.vc-node-toggle\s*\{[^}]*width:\s*1\.9rem[^}]*height:\s*1\.9rem[^}]*margin-right:\s*-\.22rem/
  );
  assert.match(
    css,
    /\.vc-node-toggle svg\s*\{[^}]*width:\s*1\.18rem[^}]*height:\s*1\.18rem/
  );
  assert.match(
    css,
    /\.vc-request-group\s*\{[^}]*padding:\s*\.1rem\s+\.18rem\s+\.18rem/
  );
});

test("expanded node body remeasures natural height after parameter edits", () => {
  const canvas =
    read("front/js/canvasNode.js");

  const start =
    canvas.indexOf(
      "listen(\n  nodesLayer,\n  'input'"
    );
  const end =
    canvas.indexOf(
      "    /*\n      연결선은",
      start
    );
  const handler =
    canvas.slice(
      start,
      end
    );

  const reset =
    handler.indexOf(
      "body.style.height =\n          'auto'"
    );
  const measure =
    handler.indexOf(
      "body.scrollHeight"
    );

  assert.ok(
    start >= 0 &&
    end > start
  );
  assert.ok(
    reset >= 0,
    "parameter edits must clear the old explicit node body height"
  );
  assert.ok(
    measure > reset,
    "natural height must be measured only after the explicit height is cleared"
  );
});
