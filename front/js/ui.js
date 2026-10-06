(function(global){
"use strict";

const createUI=
  global.createOvllWorkspaceUI;

if(typeof createUI!=="function"){
  throw new Error(
    "Ovll Workspace UI factory가 없습니다."
  );
}

global.AstraUI=
  createUI({
    root:document,
    workspace:
      document.querySelector(
        "#workspace"
      ),
    chatPage:
      document.querySelector(
        "#chat-page"
      ),
    canvasPage:
      document.querySelector(
        "#canvas-page"
      ),
    modeSwitch:
      document.querySelector(
        "#mode-switch"
      ),
    history:true,
    navigation:
      global.OvllNavigation,
    navigationEvents:true,
    viewportRoot:
      document.documentElement,
    themeRoot:
      document.documentElement
  });

})(window);
