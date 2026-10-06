import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../front/css/node.css", import.meta.url), "utf8");
const canvasNode = fs.readFileSync(new URL("../front/js/canvasNode.js", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

function cssBlock(selector) {
  const marker = `${selector} {`;
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, `missing selector: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

test("dark nodes keep the icon one-layer and use neutral request surfaces", () => {
  assert.match(css, /:root\.dark\s+\.vc-node-icon\s*\{[\s\S]*?background:\s*transparent;/);
  const darkRequest = css.match(/:root\.dark\s+\.vc-request-group\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.doesNotMatch(darkRequest, /var\(--node-color\)/);
  assert.match(darkRequest, /var\(--text\)\s+4\.5%/);
});

test("light request surface keeps a low-contrast boundary", () => {
  const request = css.match(/\.vc-request-group\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(request, /var\(--bg\)\s+82%/);
  assert.match(request, /var\(--text\)\s+6%/);
});

test("expanded footer buttons share width", () => {
  const run = cssBlock(".vc-node-run");
  const del = cssBlock(".vc-node-delete");
  assert.match(run, /flex:\s*1 1 0/);
  assert.match(del, /flex:\s*1 1 0/);
});

test("file node follows the same compact one-line identity hierarchy", () => {
  const titleWrap = cssBlock(".vc-file-title-wrap");
  const type = cssBlock(".vc-file-type");
  assert.match(titleWrap, /flex-direction:\s*row/);
  assert.match(titleWrap, /align-items:\s*center/);
  assert.match(type, /border-radius:\s*999px/);
});

test("action icons share the rounded closed visual language", () => {
  const runCss = cssBlock(".vc-node-run svg");
  const deleteCss = cssBlock(".vc-node-delete svg");
  assert.match(runCss, /width:\s*1\.02rem/);
  assert.match(deleteCss, /width:\s*1\.02rem/);
  assert.match(canvasNode, /run:\s*`[\s\S]*?<circle cx="10" cy="10" r="6\.05"/);
  assert.match(canvasNode, /delete:\s*`[\s\S]*?<rect x="5\.35" y="6\.4" width="9\.3" height="8\.45" rx="2\.15"/);
});

test("all default node icons are balanced rounded closed shapes", () => {
  assert.equal((server.match(/icon:\s*`\s*<svg viewBox="0 0 20 20"/g) || []).length, 7);
  assert.match(server, /organize:\s*\{[\s\S]*?<rect x="3\.7" y="3\.7" width="12\.6" height="12\.6" rx="3"/);
  assert.match(server, /write:\s*\{[\s\S]*?stroke-width="2\.15" stroke-linecap="round"/);
  assert.match(server, /file:\s*\{[\s\S]*?M5\.45 3\.65h5\.2l3\.9 3\.9v7\.05a1\.75 1\.75/);
  assert.match(server, /createFile:\s*\{[\s\S]*?M10 3\.55c\.43 3\.2/);
});

test("ports and connection lines use pale real colors instead of opacity dimming", () => {
  const port = cssBlock(".vc-port-pill");
  const connection = cssBlock(".vc-connection");
  assert.match(port, /var\(--node-color\)\s+34%/);
  assert.match(port, /opacity:\s*1/);
  assert.doesNotMatch(port, /opacity:\s*\.[0-9]/);
  assert.match(connection, /var\(--connection-color, var\(--text\)\)\s+34%/);
  assert.match(connection, /opacity:\s*1/);
  assert.match(canvasNode, /path\.style\.setProperty\(\s*'--connection-color'/);
});

test("mobile keeps node identity legible and actions touchable", () => {
  assert.match(css, /@media \(max-width: 37\.5rem\)[\s\S]*?\.vc-node-title\s*\{\s*font-size:\s*\.82rem/);
  assert.match(css, /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.vc-node-run,\s*\.vc-node-delete\s*\{[\s\S]*?padding-inline:\s*\.55rem/);
});
