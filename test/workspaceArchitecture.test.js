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
    read("server.js");
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

