/* Shared ordered boot assets and offline dependencies. Paths stay relative for native shells. */
(function(global){
'use strict';
const scripts=Object.freeze([
  "./js/functions.js",
  "./js/fileStore.js",
  "./js/artifactVisuals.js",
  "./js/artifactRequest.js",
  "./js/svgLibrary.js",
  "./js/skillReferenceUI.js",
  "./js/ovllComposer.js",
  "./js/previewSandbox.js",
  "./js/api.js",
  "./js/ovllPointerApi.js",
  "./js/ovllPointerProjection.js",
  "./js/ovllPointerGraphPatch.js",
  "./js/canvasSkill.js",
  "./js/navigation.js",
  "./js/workspaceUi.js",
  "./js/ui.js",
  "./js/workspaceStore.js",
  "./js/ovllPointerActivity.js",
  "./js/ovllPointerLocal.js",
  "./js/ovllPointerFunctions.js",
  "./js/ovllPointerLocalActions.js",
  "./js/customSkillStore.js",
  "./js/customSkills.js",
  "./js/canvasSkillBuilder.js",
  "./js/ovllWorkspace.js",
  "./js/libraryPage.js",
  "./js/shellMenu.js",
  "./js/workspacePresence.js",
  "./js/ovllPresence.js",
  "./js/mascot.js",
  "./js/app.js"
]);
const styles=Object.freeze([
  "./css/style.css",
  "./css/ui.css",
  "./css/skill.css",
  "./css/chat.css",
  "./css/library.css",
  "./css/shellMenu.css",
  "./css/composer.css",
  "./css/skillReferences.css"
]);
const modules=Object.freeze([
  "./js/ovllPointerGraphCore.mjs",
  "./js/ovllPointerPortTypes.mjs",
  "./js/ovllPointerPlanCore.mjs",
  "./js/ovllPointerResults.mjs",
  "./js/ovllSkillCodec.mjs",
  "./js/ovllSkillGraph.mjs",
  "./js/ovllSkillWorkspaceMigration.mjs",
  "./js/ovllSkillStorageBridge.mjs",
  "./js/ovllSkillStorageRuntime.mjs",
  "./js/ovllSkillReferences.mjs",
  "./js/ovllSkillReferenceResolver.mjs",
  "./js/ovllSkillReferenceView.mjs"
]);
const shell=Object.freeze([
  '/home', '/manifest.webmanifest', '/pwa-icon.svg', '/pwa-192.png', '/pwa-512.png',
  '/runtime-config.js', '/asset-manifest.js', '/js/boot.js'
]);
const precache=Object.freeze([...new Set([...shell,...styles,...scripts,...modules]
  .map(path=>path.startsWith('./')?path.slice(1):path))]);
global.OVLL_ASSETS=Object.freeze({scripts,styles,modules,precache});
})(typeof window!=='undefined'?window:self);
