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

test("workspace orchestrator and reusable skillNode builder are available", () => {
  const workspace =
    read("front/js/ovllWorkspace.js");
  const builder =
    read("front/js/canvasSkillBuilder.js");
  const assets =
    read("front/asset-manifest.js");

  assert.match(workspace,/createOvllWorkspace/);
  assert.match(workspace,/data-ovll-workspace/);
  assert.match(workspace,/mountSkillNodeBuilder/);
  assert.match(workspace,/pluginContext/);
  assert.match(builder,/createCanvasSkillNodeBuilder/);
  assert.match(builder,/options\.beforeReset/);
  assert.match(builder,/data-canvas-skillNode-builder-list/);
  assert.match(assets,/\.\/js\/canvasSkillBuilder\.js/);
  assert.match(assets,/\.\/js\/ovllWorkspace\.js/);
});


test("reusable workspace controls do not expose dead or ambiguous controls", () => {
  const builder =
    read("front/js/canvasSkillBuilder.js");
  assert.match(
    builder,
    /__ovllCanvasSkillNodeBuilderSeq/
  );

  assert.match(
    builder,
    /aria-controls="\$\{panelId\}"/
  );

});

test("canvas add-skillNode palette matches composer reference rows without hardcoded skillNodes", () => {
  const builder=read("front/js/canvasSkillBuilder.js");
  const css=read("front/css/ui.css");
  const composer=read("front/css/composer.css");
  assert.match(builder,/Object\.entries\(skillDefinitions\(\)\)/);
  assert.match(builder,/Number\(b\.custom\)-Number\(a\.custom\)/);
  assert.match(builder,/const description=String\(definition\.desc\|\|""\)\.trim\(\)/);
  assert.match(builder,/canvas\.addSkillNode\(type\)/);
  assert.match(css,/\.canvas-skillNode-builder-options\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)/);
  assert.match(css,/\.canvas-skillNode-builder-option\s*\{[^}]*border:\s*0/);
  assert.match(css,/\.canvas-skillNode-builder-icon\s*\{[^}]*width:\s*1\.95rem/);
  assert.match(composer,/\.ovll-composer-rich \.ovll-rich-option-icon\s*\{[^}]*width:\s*1\.95rem/);
});

test("retired standalone builder is unmounted while the live skillNode runtime remains", () => {
  const assets=read("front/asset-manifest.js");
  const html=read("front/index.html");
  const menu=read("front/js/shellMenu.js");
  const canvas=read("front/js/canvasSkill.js");
  const custom=read("front/js/customSkills.js");
  assert.doesNotMatch(assets,/\.\/js\/(?:functionWorkspace|customSkillNodePage)\.js/);
  assert.doesNotMatch(assets,/\.\/css\/customSkillNode\.css/);
  assert.doesNotMatch(html,/id="custom-skillNode-page"|data-function-workspace-host/);
  assert.doesNotMatch(menu,/data-sidebar-action="custom-skills"|OvllCustomSkillNodePage/);
  assert.match(canvas,/setSkillDefinitions/);
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


test("interactive mascot observes skillNodes from above and widens long travel arcs", () => {
  const mascot =
    read("front/js/mascot.js");

  const targetStart =
    mascot.indexOf(
      "function skillNodeTarget"
    );
  const targetEnd =
    mascot.indexOf(
      "function reactMoveToSkillNode",
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
    /skillNodeCenter\.y-\s*observationLift/
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

