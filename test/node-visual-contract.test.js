import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../front/css/node.css", import.meta.url), "utf8");
const canvasNode = fs.readFileSync(new URL("../front/js/canvasNode.js", import.meta.url), "utf8");
const catalog = fs.readFileSync(new URL("../backend/ovllPointer/nodeCatalog.js", import.meta.url), "utf8");

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
function serverNodeIcon(type) {
  const start=catalog.indexOf("const defaultNodeDef = {");
  const end=catalog.indexOf("const CUSTOM_NODE_TYPE_RE",start);
  const definitions=catalog.slice(start,end);
  const from=definitions.indexOf(`\n  ${type}: {`);
  assert.notEqual(from,-1,`missing server definition: ${type}`);
  const to=definitions.indexOf("\n  },",from);
  const node=definitions.slice(from,to<0?definitions.length:to);
  const key=node.match(/iconKey:\s*['"]([^'"]+)['"]/)?.[1];
  assert.ok(key,`missing iconKey for ${type}`);

  const libraryStart=catalog.indexOf("const iconSvg = Object.freeze({");
  const libraryEnd=catalog.indexOf("\n});",libraryStart);
  const library=catalog.slice(libraryStart,libraryEnd);
  const marker=`  ${key}: \``;
  const iconAt=library.indexOf(marker);
  assert.notEqual(iconAt,-1,`missing catalog icon: ${key}`);
  const begin=iconAt+marker.length;
  const finish=library.indexOf("\`,",begin);
  assert.notEqual(finish,-1,`unterminated catalog icon: ${key}`);
  return library.slice(begin,finish);
}


test("request area stays flat and visually attached to the node title", () => {
  assert.match(css, /:root\.dark\s+\.vc-node-icon\s*\{[\s\S]*?background:\s*transparent;/);

  const request = css.match(/\.vc-request-group\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const expandedBody = css.match(/\.vc-node\.vc-expanded\s+\.vc-node-body\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(request, /padding:\s*\.1rem\s*\.18rem\s*\.18rem/);
  assert.match(request, /border:\s*0/);
  assert.match(request, /background:\s*transparent/);
  assert.match(expandedBody, /margin-top:\s*\.18rem/);
  assert.match(css, /\.vc-request-input\s*\{[\s\S]*?min-height:\s*1\.7rem/);
  assert.doesNotMatch(css, /:root\.dark\s+\.vc-request-group\s*\{/);
});

test("node icons align to their visible glyph width without hidden x-space", () => {
  const icon = cssBlock(".vc-node-icon");
  assert.match(icon, /width:\s*1\.75rem/);
  assert.match(icon, /flex:\s*0 0 1\.75rem/);
  assert.match(icon, /justify-content:\s*flex-start/);
  assert.match(cssBlock(".vc-node-icon svg"), /width:\s*1\.455rem/);
  assert.match(cssBlock(".vc-node-icon svg [stroke]"), /stroke-width:\s*1\.152/);
});

test("node titles use a lighter identity weight", () => {
  assert.match(cssBlock(".vc-node-title"), /font-weight:\s*630/);
  assert.match(cssBlock(".vc-file-title"), /font-weight:\s*630/);
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

test("node footer actions use balanced rounded stroke glyphs and compact spacing", () => {
  const runCss = cssBlock(".vc-node-run svg");
  const deleteCss = cssBlock(".vc-node-delete svg");
  const runButton = cssBlock(".vc-node-run");
  const deleteButton = cssBlock(".vc-node-delete");

  assert.match(runCss, /width:\s*1\.04rem/);
  assert.match(deleteCss, /width:\s*1\.04rem/);
  assert.match(runButton, /gap:\s*\.12rem/);
  assert.match(deleteButton, /gap:\s*\.12rem/);
  assert.match(runButton, /padding:\s*0\s+\.4rem/);
  assert.match(deleteButton, /padding:\s*0\s+\.4rem/);
  assert.match(runButton, /font-size:\s*\.66rem/);
  assert.match(deleteButton, /font-size:\s*\.66rem/);
  assert.match(runButton, /font-weight:\s*620/);
  assert.match(deleteButton, /font-weight:\s*620/);
  assert.match(runButton, /color:\s*var\(--node-color\)/);
  assert.match(runCss, /color:\s*currentColor/);
  assert.match(deleteCss, /color:\s*currentColor/);
  assert.match(cssBlock(".vc-node-run:hover"), /color:\s*var\(--node-color\)/);
  assert.match(runButton, /var\(--node-color\)\s+7%/);
  assert.match(deleteButton, /var\(--text\)\s+5\.6%/);

  const runStart = canvasNode.indexOf("run: `");
  const runEnd = canvasNode.indexOf("stop: `", runStart);
  const runIcon = canvasNode.slice(runStart, runEnd);
  assert.match(runIcon, /M7\.5 5\.7c-\.52-\.33-1\.2\.05-1\.2\.67v7\.26/);
  assert.match(runIcon, /stroke-width="1\.42"/);
  assert.match(runIcon, /stroke-linecap="round"/);
  assert.match(runIcon, /stroke-linejoin="round"/);
  assert.doesNotMatch(runIcon, /fill="currentColor"/);

  const deleteStart = canvasNode.indexOf("delete: `");
  const deleteEnd = canvasNode.indexOf("run: `", deleteStart);
  const deleteIcon = canvasNode.slice(deleteStart, deleteEnd);
  assert.match(deleteIcon, /M5\.65 6\.55h8\.7/);
  assert.match(deleteIcon, /stroke-width="1\.42"/);
  assert.match(deleteIcon, /stroke-linecap="round"/);
  assert.match(deleteIcon, /stroke-linejoin="round"/);
  assert.doesNotMatch(deleteIcon, /fill="currentColor"/);
});

test("server-owned node icons share one rounded monoline visual contract", () => {
  const icons =
    Object.fromEntries(
      [
        "start",
        "research",
        "organize",
        "judge",
        "write",
        "file",
        "createFile"
      ].map(
        type => [
          type,
          serverNodeIcon(type)
        ]
      )
    );

  for (
    const [type, icon] of
    Object.entries(icons)
  ) {
    assert.match(
      icon,
      /viewBox="0 0 20 20"/,
      `${type} viewBox`
    );
    assert.match(
      icon,
      /fill="none"/,
      `${type} outline root`
    );
    assert.match(
      icon,
      /stroke="currentColor"/,
      `${type} currentColor stroke`
    );
    assert.match(
      icon,
      /stroke-linecap="round"/,
      `${type} rounded cap`
    );
    assert.match(
      icon,
      /stroke-linejoin="round"/,
      `${type} rounded join`
    );
    assert.doesNotMatch(
      icon,
      /fill="currentColor"/,
      `${type} must stay outline-first`
    );
    assert.doesNotMatch(
      icon,
      /var\(--node\)/,
      `${type} must not depend on node background`
    );
    assert.match(
      icon,
      /stroke-width="1\.28"/,
      `${type} shared stroke width`
    );
  }

});

test("approved custom icon selection is centralized without rejected icons",()=>{
  const start=catalog.indexOf("const iconSvg = Object.freeze({");
  const end=catalog.indexOf("\n});",start);
  const text=catalog.slice(start,end);
  const names=[...text.matchAll(/^\s+(?:'([^']+)'|([a-z][a-zA-Z0-9]*)):\s*\`/gm)]
    .map(item=>item[1]||item[2]);
  assert.equal(names.length,19);
  for(const name of ["open-book","flask","potted-plant","graduation-cap","pencil","lightbulb","hourglass","planet","headphones","coffee-cup","compass"]){
    assert.ok(names.includes(name),`missing ${name}`);
  }
  for(const name of ["brain","bar-chart","bag","puzzle-piece"]){
    assert.ok(!names.includes(name),`rejected icon present: ${name}`);
  }
});

test("ports and connection lines are neutral borderless geometry", () => {
  const port = cssBlock(".vc-port-pill");
  const connection = cssBlock(".vc-connection");
  const dragConnection = cssBlock(".vc-drag-connection");

  assert.match(port, /border:\s*\.0625rem solid/);
  assert.match(port, /background:\s*var\(--node\)/);
  assert.match(port, /var\(--text\)\s+var\(--port-contrast, 18%\)/);
  assert.match(port, /border-radius:\s*50%/);

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
  assert.match(css, /@media \(max-width: 37\.5rem\)[\s\S]*?\.vc-node-icon\s*\{[\s\S]*?width:\s*1\.704rem[\s\S]*?flex-basis:\s*1\.704rem/);
  assert.match(css, /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.vc-node-run,\s*\.vc-node-delete\s*\{[\s\S]*?padding-inline:\s*\.55rem/);
});
