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
    /#topbar-left\s*,\s*#topbar-right\s*\{[^}]*width:\s*var\(--control-size\)[^}]*height:\s*var\(--control-size\)/
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

test("library keeps desktop browser context and uses replacement detail on mobile", () => {
  const css = compact(read("front/css/library.css"));

  assert.match(
    css,
    /@media\s*\(min-width:\s*46\.01rem\)[^{]*\{[\s\S]*?\.ovll-library-content\.has-selection\s*\{[^}]*grid-template-columns:\s*minmax\(18rem,\s*24rem\)\s+minmax\(0,\s*1fr\)/
  );

  assert.match(
    css,
    /@media\s*\(max-width:\s*46rem\)[^{]*\{[\s\S]*?\.ovll-library-content\.has-selection\s+\.ovll-library-browser\s*\{[^}]*display:\s*none/
  );
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

test("library title row reserves the global sidebar trigger rail", () => {
  const css = compact(read("front/css/library.css"));

  assert.match(
    css,
    /#library-page\s*\{[^}]*--library-nav-reserve:\s*3\.25rem/
  );
  assert.match(
    css,
    /\.ovll-library-title-row\s*\{[^}]*padding-left:\s*var\(--library-nav-reserve\)/
  );
});

test("library keyboard focus remains visibly discoverable", () => {
  const libraryCss = compact(read("front/css/library.css"));
  const chatCss = compact(read("front/css/chat.css"));

  assert.match(
    libraryCss,
    /\.ovll-library-search:focus-within\s*\{/
  );
  assert.match(
    libraryCss,
    /\.ovll-library-back:focus-visible\s*\{/
  );
  assert.match(
    libraryCss,
    /\.ovll-library-detail-action:focus-visible\s*\{/
  );
  assert.match(
    chatCss,
    /\.astra-artifact-card:focus-visible\s*\{/
  );
});

test("library page owns Escape and focus lifecycle", () => {
  const js = read("front/js/libraryPage.js");

  assert.match(js, /returnFocus/);
  assert.match(js, /event\.key\s*===\s*"Escape"/);
  assert.match(js, /restorePageFocus/);
  assert.match(js, /focusLibraryEntry/);
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
