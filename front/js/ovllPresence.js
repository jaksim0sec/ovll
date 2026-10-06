(function(global){
"use strict";

const createPresence=
  global.createOvllPresence;

if(typeof createPresence!=="function"){
  throw new Error(
    "Ovll Presence factory가 없습니다."
  );
}

global.OvllPresence=
  createPresence({
    document,
    root:document,
    ui:global.AstraUI,
    chatPage:
      document.querySelector(
        "#chat-page"
      ),
    chatMessages:
      document.querySelector(
        "#chat-messages"
      ),
    canvasPage:
      document.querySelector(
        "#canvas-page"
      ),
    canvasWorld:
      document.querySelector(
        "#canvas-world"
      ),
    globalMascotFallback:true
  });

})(window);
