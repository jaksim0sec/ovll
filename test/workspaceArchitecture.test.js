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
  const boot =
    read("front/js/boot.js");

  assert.match(factory,/createOvllWorkspaceUI/);
  assert.match(factory,/Math\.max\(\s*absX,\s*absY\s*\) < 8/);
  assert.match(factory,/velocity < -\.34 \|\|\s*progress >= \.42/);
  assert.match(factory,/Math\.abs\(dx\) > 5/);
  assert.match(factory,/velocity > \.34/);
  assert.match(factory,/velocity < -\.34/);
  assert.match(factory,/if \(!historyEnabled\)/);
  assert.match(factory,/gestureBlockSelector/);
  assert.match(bootstrap,/global\.AstraUI\s*=\s*createUI/);
  assert.match(boot,/\.\/js\/workspaceUi\.js/);
});

test("workspace presence is factory-backed and root scoped", () => {
  const factory =
    read("front/js/workspacePresence.js");
  const bootstrap =
    read("front/js/ovllPresence.js");
  const boot =
    read("front/js/boot.js");

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
    boot,
    /\.\/js\/workspacePresence\.js/
  );
});

test("workspace orchestrator and reusable node builder are available", () => {
  const workspace =
    read("front/js/ovllWorkspace.js");
  const builder =
    read("front/js/canvasNodeBuilder.js");
  const boot =
    read("front/js/boot.js");

  assert.match(workspace,/createOvllWorkspace/);
  assert.match(workspace,/data-ovll-workspace/);
  assert.match(workspace,/mountNodeBuilder/);
  assert.match(workspace,/pluginContext/);
  assert.match(builder,/createCanvasNodeBuilder/);
  assert.match(builder,/options\.beforeReset/);
  assert.match(builder,/data-canvas-node-builder-list/);
  assert.match(boot,/\.\/js\/canvasNodeBuilder\.js/);
  assert.match(boot,/\.\/js\/ovllWorkspace\.js/);
});

test("function builder uses the shared workspace and isolated planner purpose", () => {
  const feature =
    read("front/js/functionWorkspace.js");
  const api =
    read("front/js/api.js");
  const server =
    read("backend/ovllPointer/legacyCompatibility.js");
  const page =
    read("front/js/customNodePage.js");
  const html =
    read("front/index.html");

  assert.match(feature,/createWorkspace\(/);
  assert.match(feature,/pluginContext:\s*"custom-builder"/);
  assert.match(feature,/mountNodeBuilder/);
  assert.match(feature,/workspace\.presence/);
  assert.match(feature,/purpose:\s*"function-builder"/);
  assert.match(api,/options\.purpose===\s*"function-builder"/);
  assert.match(server,/FUNCTION_BUILDER_PROMPT/);
  assert.match(server,/validateFunctionBuilderWorkflow/);
  assert.match(server,/purpose ===\s*'function-builder'/);
  assert.match(page,/createOvllFunctionWorkspace/);
  assert.doesNotMatch(html,/ovll-custom-sidebar/);
  assert.match(html,/data-function-workspace-host/);
});

test("reusable workspace controls do not expose dead or ambiguous controls", () => {
  const builder =
    read("front/js/canvasNodeBuilder.js");
  const feature =
    read("front/js/functionWorkspace.js");

  assert.match(
    builder,
    /__ovllCanvasNodeBuilderSeq/
  );

  assert.match(
    builder,
    /aria-controls="\$\{panelId\}"/
  );

  assert.match(
    feature,
    /composerAttach[\s\S]*?\.hidden=true/
  );
});

test("main workspace owns the interactive mascot lifecycle", () => {
  const app =
    read("front/js/app.js");
  const boot =
    read("front/js/boot.js");
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
    boot.indexOf("./js/mascot.js") <
      boot.indexOf("./js/app.js"),
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

test("function builder keeps contextual identity out of the global topbar lane", () => {
  const feature =
    read("front/js/functionWorkspace.js");
  const css =
    read("front/css/customNode.css");

  assert.doesNotMatch(
    feature,
    /headerStart\?\.appendChild\(\s*context\s*\)/
  );
  assert.match(
    feature,
    /overlay\?\.appendChild\(\s*context\s*\)/
  );
  assert.match(
    css,
    /\.ovll-function-context\s*\{[^}]*position:\s*absolute[^}]*top:\s*calc\(/s
  );
  assert.match(
    css,
    /--global-nav-leading-end/
  );
});

test("function builder can save a valid unnamed draft and reports storage failures", () => {
  const feature =
    read("front/js/functionWorkspace.js");

  assert.doesNotMatch(
    feature,
    /if\(!name\)\{[\s\S]*?return false/
  );
  assert.match(
    feature,
    /\|\|\s*"새 함수"/
  );
  assert.match(
    feature,
    /try\{[\s\S]*?Store\.save\([\s\S]*?catch\(error\)/
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

