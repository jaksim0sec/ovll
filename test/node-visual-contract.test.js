import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(
  new URL("../front/css/node.css", import.meta.url),
  "utf8"
);

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
