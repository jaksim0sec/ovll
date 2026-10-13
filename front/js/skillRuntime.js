(function(global){
"use strict";
const factory=global.OvllSkillRuntimeFactory;
if(!factory)return; // Isolated legacy test harnesses load classic assets directly.
global.OvllSkillLocal=factory.createSkillLocal({
  legacy:global.OvllPointerLocal,
  api:global.OvllPointerApi
});
})(window);
