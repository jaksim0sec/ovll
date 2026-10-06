import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(
  new URL("../front/css/node.css", import.meta.url),
  "utf8"
);

const canvasNode = fs.readFileSync(
  new URL("../front/js/canvasNode.js", import.meta.url),
  "utf8"
);

const server = fs.readFileSync(
  new URL("../server.js", import.meta.url),
  "utf8"
);

function cssBlock(selector) {
  const marker = `${selector} {`;
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, `missing selector: ${selector}`);

  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);

  return css.slice(open + 1, close);
}

test("dark nodes keep the icon one-layer and use neutral request surfaces", () => {
  assert.match(
    css,
    /:root\.dark\s+\.vc-node-icon\s*\{[\s\S]*?background:\s*transparent;/
  );

  const darkRequest = css.match(
    /:root\.dark\s+\.vc-request-group\s*\{([\s\S]*?)\n\}/
  )?.[1] ?? "";

  assert.doesNotMatch(darkRequest, /var\(--node-color\)/);
  assert.match(darkRequest, /var\(--text\)\s+4\.5%/);
});

test("light request surface is separated without adding a permanent border", () => {
  const request = css.match(
    /\.vc-request-group\s*\{([\s\S]*?)\n\}/
  )?.[1] ?? "";

  assert.match(request, /var\(--bg\)\s+82%/);
  assert.match(request, /border:[\s\S]*?transparent;/);
  assert.match(request, /padding:[\s\S]*?\.54rem[\s\S]*?\.58rem/);
});

test("expanded footer buttons share width instead of clipping the delete action", () => {
  const run = css.match(
    /\.vc-node-run\s*\{([\s\S]*?)\n\}/
  )?.[1] ?? "";

  const del = css.match(
    /\.vc-node-delete\s*\{([\s\S]*?)\n\}/
  )?.[1] ?? "";

  assert.match(run, /flex:\s*1 1 0;/);
  assert.match(run, /min-width:\s*0;/);
  assert.match(del, /flex:\s*1 1 0;/);
  assert.match(del, /min-width:\s*0;/);
  assert.match(del, /width:\s*auto;/);
});

test("mobile keeps node identity legible and touch buttons compact", () => {
  assert.match(
    css,
    /@media \(max-width: 37\.5rem\)[\s\S]*?\.vc-node-title\s*\{\s*font-size:\s*\.82rem;/
  );

  assert.match(
    css,
    /@media \(max-width: 37\.5rem\)[\s\S]*?\.vc-node-icon svg\s*\{[\s\S]*?width:\s*1\.42rem;[\s\S]*?height:\s*1\.42rem;/
  );

  assert.match(
    css,
    /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.vc-node-run,\s*\.vc-node-delete\s*\{[\s\S]*?padding-inline:\s*\.55rem;/
  );
});


test("file node follows the same compact one-layer identity hierarchy", () => {
  const head = cssBlock(".vc-file-node .vc-node-head");
  const icon = cssBlock(".vc-file-node .vc-node-icon");
  const titleWrap = cssBlock(".vc-file-title-wrap");
  const type = cssBlock(".vc-file-type");

  assert.match(head, /min-height:\s*1\.9rem/);
  assert.match(head, /gap:\s*\.42rem/);
  assert.match(icon, /background:\s*transparent/);
  assert.match(titleWrap, /flex:\s*1 1 auto/);
  assert.match(type, /border:\s*0/);
  assert.match(type, /background:\s*transparent/);

  assert.equal(
    css.includes("FILE NODE DETAIL"),
    false,
    "file node styles must have one source of truth"
  );
});

test("node identity gap and action buttons stay visually quiet", () => {
  assert.match(
    cssBlock(".vc-node-head"),
    /gap:\s*\.42rem/
  );

  const run = cssBlock(".vc-node-run");
  const del = cssBlock(".vc-node-delete");

  assert.match(run, /border:\s*0/);
  assert.doesNotMatch(run, /var\(--node-color\)/);
  assert.match(del, /border:\s*0/);

  const runIcon =
    canvasNode.match(
      /run:\s*`([\s\S]*?)`,\n\s*stop:/
    )?.[1] ?? "";

  assert.doesNotMatch(runIcon, /<circle/);
  assert.match(runIcon, /M7\.1 5\.7 14\.2 10l-7\.1 4\.3V5\.7Z/);
});

test("write organize and file icons are closed semantic shapes", () => {
  assert.match(
    server,
    /organize:\s*\{[\s\S]*?<rect x="5\.1" y="3\.5" width="9\.8" height="3\.2"/
  );

  assert.match(
    server,
    /write:\s*\{[\s\S]*?M5\.3 3\.4h6\.1l3\.3 3\.3v9\.8H5\.3Z/
  );

  assert.match(
    server,
    /file:\s*\{[\s\S]*?M5\.2 3\.35h6\.05l3\.55 3\.55v9\.75H5\.2V3\.35Z/
  );
});
