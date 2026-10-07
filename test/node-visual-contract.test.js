import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../front/css/node.css", import.meta.url), "utf8");
const canvasNode = fs.readFileSync(new URL("../front/js/canvasNode.js", import.meta.url), "utf8");
const svgLibrary = fs.readFileSync(new URL("../front/js/svgLibrary.js", import.meta.url), "utf8");

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

test("request panels keep the node body visually compact", () => {
  const request = css.match(/\.vc-request-group\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const expandedBody = css.match(/\.vc-node\.vc-expanded\s*\n\.vc-node-body\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(request, /padding:\s*\.46rem\s*\.5rem/);
  assert.match(request, /border-radius:\s*\.8rem/);
  assert.match(request, /var\(--bg\)\s+82%/);
  assert.match(expandedBody, /margin-top:\s*\.38rem/);
  assert.match(css, /\.vc-request-input\s*\{[\s\S]*?min-height:\s*2\.3rem/);
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

test("node action icons are semantic rounded stroke glyphs with balanced text hierarchy", () => {
  const runCss = cssBlock(".vc-node-run svg");
  const deleteCss = cssBlock(".vc-node-delete svg");
  const runButton = cssBlock(".vc-node-run");
  const deleteButton = cssBlock(".vc-node-delete");

  assert.match(runCss, /width:\s*\.92rem/);
  assert.match(deleteCss, /width:\s*\.92rem/);
  assert.match(runButton, /gap:\s*\.3rem/);
  assert.match(deleteButton, /gap:\s*\.3rem/);
  assert.match(runButton, /font-size:\s*\.66rem/);
  assert.match(deleteButton, /font-size:\s*\.66rem/);

  const runStart = canvasNode.indexOf("run: \`");
  const runEnd = canvasNode.indexOf("stop: \`", runStart);
  const runIcon = canvasNode.slice(runStart, runEnd);
  assert.match(runIcon, /<rect x="3\.85" y="4\.65" width="12\.3" height="10\.7" rx="3\.2"/);
  assert.doesNotMatch(runIcon, /<circle/);
  assert.match(runIcon, /stroke-linejoin="round"/);

  const deleteStart = canvasNode.indexOf("delete: \`");
  const deleteEnd = canvasNode.indexOf("run: \`", deleteStart);
  const deleteIcon = canvasNode.slice(deleteStart, deleteEnd);
  assert.match(deleteIcon, /M5\.95 7\.15h8\.1/);
  assert.match(deleteIcon, /M7\.15 7\.2l\.48 7\.05/);
  assert.match(deleteIcon, /M8\.05 5\.4/);
});

test("all default node icons are balanced rounded closed shapes", () => {
  assert.equal((svgLibrary.match(/^  (?:start|research|organize|judge|write|file|createFile):`/gm) || []).length, 7);
  assert.match(svgLibrary, /organize:\s*`[\s\S]*?<rect x="3\.7" y="3\.7" width="12\.6" height="12\.6" rx="3"/);
  assert.match(svgLibrary, /write:\s*`[\s\S]*?stroke-width="2\.15" stroke-linecap="round"/);
  assert.match(svgLibrary, /file:\s*`[\s\S]*?M5\.45 3\.65h5\.2l3\.9 3\.9v7\.05a1\.75 1\.75/);
  assert.match(svgLibrary, /createFile:\s*`[\s\S]*?M10 3\.55c\.43 3\.2/);
});

test("ports and connection lines are neutral borderless geometry", () => {
  const port = cssBlock(".vc-port-pill");
  const connection = cssBlock(".vc-connection");
  const dragConnection = cssBlock(".vc-drag-connection");

  assert.match(port, /border:\s*0/);
  assert.match(port, /var\(--text\)\s+18%/);
  assert.doesNotMatch(port, /var\(--node-color\)/);

  assert.match(connection, /var\(--text\)\s+18%/);
  assert.doesNotMatch(connection, /--connection-color/);
  assert.match(dragConnection, /var\(--text\)\s+42%/);

  assert.doesNotMatch(
    canvasNode,
    /path\.style\.setProperty\(\s*['"]--connection-color/
  );
  assert.doesNotMatch(
    canvasNode,
    /path\.style\.stroke\s*=\s*definition\.color/
  );
  assert.doesNotMatch(
    canvasNode,
    /dot\.style\.fill\s*=\s*definition\.color/
  );
});

test("mobile keeps node identity legible and actions touchable", () => {
  assert.match(css, /@media \(max-width: 37\.5rem\)[\s\S]*?\.vc-node-title\s*\{\s*font-size:\s*\.82rem/);
  assert.match(css, /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.vc-node-run,\s*\.vc-node-delete\s*\{[\s\S]*?padding-inline:\s*\.55rem/);
});
