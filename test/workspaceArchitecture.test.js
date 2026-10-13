import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = path =>
  fs.readFileSync(
    new URL(
      "../" + path,
      import.meta.url
    ),
    "utf8"
  );

test("workspace UI is factory-backed and preserves gesture constants", () => {
  const factory =
    read("front/js/workspaceUi.js");
  const bootstrap =
    read("front/js/ui.js");
  const assets =
    read("front/asset-manifest.js");

  assert.match(factory,/createOvllWorkspaceUI/);
  assert.match(factory,/Math\.max\(\s*absX,\s*absY\s*\) < 8/);
  assert.match(factory,/velocity < -\.34 \|\|\s*progress >= \.42/);
  assert.match(factory,/Math\.abs\(dx\) > 5/);
  assert.match(factory,/velocity > \.34/);
  assert.match(factory,/velocity < -\.34/);
  assert.match(factory,/if \(!historyEnabled\)/);
  assert.match(factory,/gestureBlockSelector/);
  assert.match(bootstrap,/global\.AstraUI\s*=\s*createUI/);
  assert.match(assets,/\.\/js\/workspaceUi\.js/);
});

test("workspace presence is factory-backed and root scoped", () => {
  const factory =
    read("front/js/workspacePresence.js");
  const bootstrap =
    read("front/js/ovllPresence.js");
  const assets =
    read("front/asset-manifest.js");

  assert.match(
    factory,
    /createOvllPresence/
  );

  assert.match(
    factory,
    /options\.chatPage/
  );

  assert.match(
    factory,
    /options\.canvasWorld/
  );

  assert.match(
    factory,
    /globalMascotFallback/
  );

  assert.match(
    bootstrap,
    /global\.OvllPresence\s*=\s*createPresence/
  );

  assert.match(
    assets,
    /\.\/js\/workspacePresence\.js/
  );
});

test("workspace orchestrator and reusable node builder are available", () => {
  const workspace =
    read("front/js/ovllWorkspace.js");
  const builder =
    read("front/js/canvasNodeBuilder.js");
  const assets =
    read("front/asset-manifest.js");

  assert.match(workspace,/createOvllWorkspace/);
  assert.match(workspace,/data-ovll-workspace/);
  assert.match(workspace,/mountNodeBuilder/);
  assert.match(workspace,/pluginContext/);
  assert.match(builder,/createCanvasNodeBuilder/);
  assert.match(builder,/options\.beforeReset/);
  assert.match(builder,/data-canvas-node-builder-list/);
  assert.match(assets,/\.\/js\/canvasNodeBuilder\.js/);
  assert.match(assets,/\.\/js\/ovllWorkspace\.js/);
});


test("reusable workspace controls do not expose dead or ambiguous controls", () => {
  const builder =
    read("front/js/canvasNodeBuilder.js");
  assert.match(
    builder,
    /__ovllCanvasNodeBuilderSeq/
  );

  assert.match(
    builder,
    /aria-controls="\$\{panelId\}"/
  );

});

test("retired standalone builder is unmounted while the live node runtime remains", () => {
  const assets=read("front/asset-manifest.js");
  const html=read("front/index.html");
  const menu=read("front/js/shellMenu.js");
  const canvas=read("front/js/canvasNode.js");
  const custom=read("front/js/customNodes.js");
  assert.doesNotMatch(assets,/\.\/js\/(?:functionWorkspace|customNodePage)\.js/);
  assert.doesNotMatch(assets,/\.\/css\/customNode\.css/);
  assert.doesNotMatch(html,/id="custom-node-page"|data-function-workspace-host/);
  assert.doesNotMatch(menu,/data-sidebar-action="custom-nodes"|OvllCustomNodePage/);
  assert.match(canvas,/setNodeDefinitions/);
  assert.match(custom,/pluginDefinitions/);
});

test("main workspace owns the interactive mascot lifecycle", () => {
  const app =
    read("front/js/app.js");
  const assets =
    read("front/asset-manifest.js");
  const mascot =
    read("front/js/mascot.js");

  const ensureStart =
    app.indexOf("function ensureMainWorkspace");
  const canvasStart =
    app.indexOf("async function initializeCanvas");
  const mainWorkspace =
    app.slice(ensureStart, canvasStart);
  const bindStart =
    app.indexOf(".bindCanvas(", canvasStart);
  const bindCanvas =
    app.slice(bindStart, bindStart + 220);

  assert.doesNotMatch(
    mainWorkspace,
    /mascot:\s*false/
  );
  assert.doesNotMatch(
    bindCanvas,
    /mascot:\s*false/
  );
  assert.ok(
    assets.indexOf("./js/mascot.js") <
      assets.indexOf("./js/app.js"),
    "mascot mount API must exist before app binds the main canvas"
  );
  assert.match(
    mascot,
    /OvllMainWorkspace[\s\S]*?getMascot/
  );
});


test("interactive mascot observes nodes from above and widens long travel arcs", () => {
  const mascot =
    read("front/js/mascot.js");

  const targetStart =
    mascot.indexOf(
      "function nodeTarget"
    );
  const targetEnd =
    mascot.indexOf(
      "function reactMoveToNode",
      targetStart
    );
  const target =
    mascot.slice(
      targetStart,
      targetEnd
    );

  const swooshStart =
    mascot.indexOf(
      "function swooshToward"
    );
  const swoosh =
    mascot.slice(
      swooshStart,
      targetStart
    );

  assert.match(
    target,
    /const\s+observationLift/
  );
  assert.match(
    target,
    /nodeCenter\.y-\s*observationLift/
  );
  assert.match(
    swoosh,
    /const\s+arcProgress/
  );
  assert.match(
    swoosh,
    /arcProgress\*\.62/
  );
  assert.match(
    swoosh,
    /arcProgress\*\.07/
  );
});



test("standalone pages preserve a real back stack on docked desktop navigation", () => {
  const menu =
    read("front/js/shellMenu.js");

  assert.match(
    menu,
    /history:\s*usesDockedSidebar\(\)\s*\?\s*true\s*:\s*"replace"/
  );
});

