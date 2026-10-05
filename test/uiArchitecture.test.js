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
  assert.match(js, /event\.key\s*===\s*"Escape"/);
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
