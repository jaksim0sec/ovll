(function(global){
"use strict";
const api=global.OvllSkillReferences;
if(!api)return;

function resolverFor({snapshot,functions}={}){
  if(!snapshot?.graph)return ()=>null;
  let canonical;
  try{canonical=api.normalizeSkillSnapshot(snapshot)}catch{return ()=>null}
  const resolver=api.createSkillReferenceResolver({
    getSkillDefinitions:()=>canonical.skillDefinitions,
    getCanvasGraph:()=>canonical.graph,
    getFunctions:()=>Array.isArray(functions)?functions:[],
    getCurrentScope:()=>({graphId:canonical.graph.graphId})
  });
  return reference=>resolver.resolve(reference);
}
function renderTrustedParts(body,parts,context){
  return api.renderSkillReferenceParts(body,parts,{
    resolve:resolverFor(context),svgLibrary:global.OvllSvgLibrary
  });
}
function decorateAssistant(container,context){
  const resolve=resolverFor(context);
  const skip=new Set(['CODE','PRE','SCRIPT','STYLE','TEXTAREA']);
  function visit(parent){
    for(const node of [...parent.childNodes]){
      if(node.nodeType===1){
        if(skip.has(node.tagName)||node.closest?.('.ovll-skill-ref'))continue;
        visit(node);continue;
      }
      if(node.nodeType!==3||!node.nodeValue?.includes('⟦ovll:ref:v1:'))continue;
      const parts=api.segmentSkillReferences(node.nodeValue);
      if(!parts.some(part=>part.type==='candidate'))continue;
      const fragment=parent.ownerDocument.createDocumentFragment();
      for(const part of parts){
        if(part.type==='text'){fragment.append(parent.ownerDocument.createTextNode(part.text));continue}
        const found=resolve(part.reference);
        if(found&&api.serializeSkillReference(found.reference)===part.token)
          fragment.append(api.createSkillReferenceChip(parent.ownerDocument,found,
            {svgLibrary:global.OvllSvgLibrary}));
        else fragment.append(parent.ownerDocument.createTextNode(part.token));
      }
      node.replaceWith(fragment);
    }
  }
  visit(container);
  return container;
}
global.OvllSkillReferenceUI=Object.freeze({
  resolverFor,renderTrustedParts,decorateAssistant
});
})(window);
