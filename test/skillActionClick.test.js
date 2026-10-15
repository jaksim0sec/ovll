import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source =
  fs.readFileSync(
    new URL(
      "../front/js/canvasSkill.js",
      import.meta.url
    ),
    "utf8"
  );

test("skillNode action pointerdown stays out of canvas drag handling", () => {
  assert.match(
    source,
    /listen\(\s*skillNodesLayer,\s*['"]pointerdown['"][\s\S]*?event\.target\.closest\(\s*['"]\[data-action\]['"]\s*\)[\s\S]*?event\.stopPropagation\(\)/
  );
});

test("skillNode run still uses delegated click activation", () => {
  assert.match(
    source,
    /listen\(\s*skillNodesLayer,\s*['"]click['"][\s\S]*?action\.dataset\.action\s*===\s*['"]run['"][\s\S]*?emit\(\s*['"]skillNodeRun['"]/
  );
});
