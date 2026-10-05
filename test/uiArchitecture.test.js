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
  return String(value).replace(/\s+/g, " ");
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

test("workspace control system does not re-patch responsive composer layout", () => {
  const css = read("front/css/ui.css");
  const start = css.indexOf("WORKSPACE CONTROL SYSTEM");
  const end = css.indexOf("NON-BLOCKING ERROR NOTICE", start);
  const section = css.slice(start, end);

  assert.doesNotMatch(
    section,
    /@media\s*\(max-width:[\s\S]*?#composer-form\s*\{/
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
});test("composer keeps submit button in the flex rail", () => {
  const css = compact(read("front/css/ui.css"));

  assert.match(
    css,
    /#composer-input\s*\{[^}]*flex:\s*1\s+1\s+0[^}]*width:\s*auto/
  );
  assert.match(
    css,
    /#composer-submit\s*\{[^}]*min-width:\s*2\.375rem[^}]*min-height:\s*2\.375rem[^}]*visibility:\s*visible/
  );
  assert.match(
    css,
    /#composer-form\s*\{[^}]*overflow:\s*visible/
  );
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
    /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)[^{]*\{[\s\S]*?#composer-attach\s*\{[^}]*width:\s*2\.5rem[^}]*height:\s*2\.5rem/
  );
  assert.match(
    uiCss,
    /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)[^{]*\{[\s\S]*?#composer-submit\s*\{[^}]*width:\s*2\.5rem[^}]*height:\s*2\.5rem/
  );
});

test("sidebar source has no definition-only formatTime helper", () => {
  const js = read("front/js/shellMenu.js");
  assert.doesNotMatch(js, /function\s+formatTime\s*\(/);
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
  const boot =
    read("front/js/boot.js");
  const sw =
    read("front/sw.js");

  const policy =
    boot.indexOf(
      "./js/runtimeFinalization.js"
    );
  const app =
    boot.indexOf(
      "./js/app.js"
    );

  assert.ok(
    policy >= 0,
    "runtime finalization policy must be booted"
  );
  assert.ok(
    app > policy,
    "runtime finalization policy must load before app"
  );
  assert.match(
    sw,
    /\/js\/runtimeFinalization\.js/
  );
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

test("canvas execution is mirrored into persisted user chat", () => {
  const app =
    read(
      "front/js/app.js"
    );

  assert.match(
    app,
    /function\s+canvasRunUserText/
  );
  assert.match(
    app,
    /addUserMessage\(\s*runUserText\s*\)/
  );
  assert.match(
    app,
    /state\.lastUserRequest\s*=\s*runUserText/
  );
});

test("new chat waiting state uses neutral polite copy only", () => {
  const presence =
    read(
      "front/js/ovllPresence.js"
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

test("Gemini request logs stay lightweight and expose a dedicated log page", () => {
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
    /const\s+geminiRequestLogs\s*=/
  );
  assert.match(
    server,
    /\/api\/logs/
  );
  assert.match(
    server,
    /\/log/
  );
  assert.match(
    server,
    /pushGeminiRequestLog/
  );
  assert.match(
    page,
    /\/api\/logs/
  );
  assert.doesNotMatch(
    page,
    /GEMINI_API_KEY/
  );
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
    /120000/
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

test("PDF fallback rendering has a server-side timeout", () => {
  const artifact =
    read(
      "artifactStore.js"
    );

  assert.match(
    artifact,
    /PDF_RENDER_TIMEOUT/
  );
  assert.match(
    artifact,
    /60000/
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


test("artifact page targets are parsed and transported without confusing chapter labels", () => {
  const policy =
    read(
      "front/js/artifactRequest.js"
    );
  const app =
    read(
      "front/js/app.js"
    );
  const api =
    read(
      "front/js/api.js"
    );
  const server =
    read(
      "server.js"
    );
  const boot =
    read(
      "front/js/boot.js"
    );
  const sw =
    read(
      "front/sw.js"
    );

  assert.match(
    policy,
    /targetPages/
  );
  assert.match(
    policy,
    /페이지|쪽/
  );
  assert.match(
    policy,
    /A4/
  );
  assert.match(
    app,
    /targetPages:\s*artifactRequest/
  );
  assert.match(
    api,
    /targetPages:\s*input\?\.targetPages/
  );
  assert.match(
    server,
    /targetPages:\s*req\.body\?\.targetPages/
  );
  assert.ok(
    boot.indexOf(
      "./js/artifactRequest.js"
    ) <
    boot.indexOf(
      "./js/app.js"
    )
  );
  assert.match(
    sw,
    /\/js\/artifactRequest\.js/
  );
});

test("planner keeps document length requirements on the upstream writer", () => {
  const server =
    read(
      "server.js"
    );

  assert.match(
    server,
    /createFile[^\n]*does not generate|createFile[^\n]*does not expand/i
  );
  assert.match(
    server,
    /page|페이지|분량/i
  );
  assert.match(
    server,
    /upstream write|write\.request/i
  );
  assert.match(
    server,
    /padding|whitespace|여백/i
  );
});
