import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../front/css/node.css", import.meta.url), "utf8");
const canvasNode = fs.readFileSync(new URL("../front/js/canvasNode.js", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

function cssBlock(selector) {
  const marker = `${selector} {`;
  let start =
    css.indexOf(
      `\n${marker}`
    );

  if (start !== -1) {
    start += 1;
  } else if (
    css.startsWith(marker)
  ) {
    start = 0;
  }

  assert.notEqual(
    start,
    -1,
    `missing selector: ${selector}`
  );
  const open =
    css.indexOf("{", start);
  const close =
    css.indexOf("}", open);
  return css.slice(open + 1, close);
}

test("request area stays flat and visually attached to the node title", () => {
  assert.match(css, /:root\.dark\s+\.vc-node-icon\s*\{[\s\S]*?background:\s*transparent;/);

  const request = css.match(/\.vc-request-group\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const expandedBody = css.match(/\.vc-node\.vc-expanded\s+\.vc-node-body\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(request, /padding:\s*\.1rem\s*\.08rem\s*\.18rem\s*0/);
  assert.match(request, /border:\s*0/);
  assert.match(request, /background:\s*transparent/);
  assert.match(expandedBody, /margin-top:\s*\.18rem/);
  assert.match(css, /\.vc-request-input\s*\{[\s\S]*?min-height:\s*1\.7rem/);
  assert.doesNotMatch(css, /:root\.dark\s+\.vc-request-group\s*\{/);
});

test("node icons align to their visible glyph width without hidden x-space", () => {
  const icon = cssBlock(".vc-node-icon");
  assert.match(icon, /width:\s*1\.46rem/);
  assert.match(icon, /flex:\s*0 0 1\.46rem/);
  assert.match(icon, /justify-content:\s*flex-start/);
  assert.match(cssBlock(".vc-node-icon svg"), /width:\s*1\.46rem/);
  assert.match(cssBlock(".vc-node-icon svg [stroke]"), /stroke-width:\s*1\.2/);
});

test("node titles use a lighter identity weight", () => {
  assert.match(cssBlock(".vc-node-title"), /font-weight:\s*650/);
  assert.match(cssBlock(".vc-file-title"), /font-weight:\s*650/);
});

test("node shell and footer actions keep subtle neutral outlines by default", () => {
  const node = cssBlock(".vc-node");
  const run = cssBlock(".vc-node-run");
  const del = cssBlock(".vc-node-delete");
  assert.match(node, /border:\s*\.0625rem solid var\(--line\)/);
  assert.match(node, /box-shadow:\s*var\(--shadow-soft\)/);
  assert.doesNotMatch(node, /0 0 0/);
  assert.match(run, /inset 0 0 0 \.0625rem/);
  assert.match(del, /inset 0 0 0 \.0625rem/);
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

  assert.match(runCss, /width:\s*\.94rem/);
  assert.match(deleteCss, /width:\s*\.94rem/);
  assert.match(runCss, /opacity:\s*\.84/);
  assert.match(deleteCss, /opacity:\s*\.84/);
  assert.match(runButton, /gap:\s*\.24rem/);
  assert.match(deleteButton, /gap:\s*\.24rem/);
  assert.match(runButton, /font-size:\s*\.66rem/);
  assert.match(deleteButton, /font-size:\s*\.66rem/);
  assert.match(runButton, /font-weight:\s*620/);
  assert.match(deleteButton, /font-weight:\s*620/);
  assert.match(runButton, /var\(--text\)\s+5\.6%/);
  assert.match(deleteButton, /var\(--text\)\s+5\.6%/);

  const runStart = canvasNode.indexOf("run: \`");
  const runEnd = canvasNode.indexOf("stop: \`", runStart);
  const runIcon = canvasNode.slice(runStart, runEnd);
  assert.match(runIcon, /<rect x="4\.1" y="4\.1" width="11\.8" height="11\.8" rx="4\.1"/);
  assert.doesNotMatch(runIcon, /<circle/);
  assert.match(runIcon, /fill="currentColor"/);
  assert.match(runIcon, /stroke-width="1\.36"/);

  const deleteStart = canvasNode.indexOf("delete: \`");
  const deleteEnd = canvasNode.indexOf("run: \`", deleteStart);
  const deleteIcon = canvasNode.slice(deleteStart, deleteEnd);
  assert.match(deleteIcon, /M6\.05 6\.85h7\.9/);
  assert.match(deleteIcon, /M7\.2 6\.9l\.42 6\.45/);
  assert.match(deleteIcon, /M8\.1 5\.15h3\.8/);
  assert.match(deleteIcon, /stroke-width="1\.38"/);
});

test("server keeps built-in node icons in canonical definitions", () => {
  const definitionStart =
    server.indexOf(
      "const defaultNodeDef = {"
    );
  const definitionEnd =
    server.indexOf(
      "const CUSTOM_NODE_TYPE_RE",
      definitionStart
    );
  const definitions =
    server.slice(
      definitionStart,
      definitionEnd
    );

  for (
    const type of [
      "start",
      "research",
      "organize",
      "judge",
      "write",
      "file",
      "createFile"
    ]
  ) {
    const typeStart =
      definitions.indexOf(
        `\n  ${type}: {`
      );
    assert.notEqual(
      typeStart,
      -1,
      `missing server definition for ${type}`
    );
    const nextType =
      definitions.indexOf(
        "\n  },",
        typeStart
      );
    const section =
      definitions.slice(
        typeStart,
        nextType === -1
          ? definitions.length
          : nextType
      );
    assert.match(
      section,
      /icon:\s*`[\s\S]*?<svg/,
      `missing server icon for ${type}`
    );
  }
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
  assert.match(css, /@media \(max-width: 37\.5rem\)[\s\S]*?\.vc-node-icon\s*\{[\s\S]*?width:\s*1\.42rem[\s\S]*?flex-basis:\s*1\.42rem/);
  assert.match(css, /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.vc-node-run,\s*\.vc-node-delete\s*\{[\s\S]*?padding-inline:\s*\.55rem/);
});
