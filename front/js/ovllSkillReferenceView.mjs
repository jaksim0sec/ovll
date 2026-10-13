import {segmentSkillReferences,serializeSkillReference} from './ovllSkillReferences.mjs';

// Safe DOM-only presentation of references. Parsing never authorizes a Skill;
// resolve() must use a verified in-scope catalog before any chip is rendered.
const kinds=Object.freeze({
  'skill-definition':'정의된 스킬',
  'skill-canvas':'캔버스 스킬',
  function:'저장 함수'
});
function appendText(doc,container,text){
  if(text)container.append(doc.createTextNode(String(text)));
}
function resolveReference(resolve,ref){
  if(typeof resolve!=='function')return null;
  try{
    const item=resolve(ref);
    if(!item||item.kind!==ref.kind||
      !item.reference||item.disabled===true)return null;
    // The registry's actual identity must match the referenced token.
    if(serializeSkillReference(item.reference)!==serializeSkillReference(ref))return null;
    return item;
  }catch{return null}
}
export function createSkillReferenceChip(doc,resolved,{svgLibrary}={}){
  if(!resolved||!kinds[resolved.kind]||!resolved.reference)
    throw new TypeError('INVALID_RESOLVED_SKILL_REFERENCE');
  const token=serializeSkillReference(resolved.reference);
  const chip=doc.createElement('span');
  chip.className='ovll-skill-ref';
  chip.setAttribute('data-ovll-ref-kind',resolved.kind);
  chip.setAttribute('data-ovll-ref-token',token);
  const name=String(resolved.label||'').slice(0,120);
  chip.setAttribute('aria-label',kinds[resolved.kind]+': '+name);
  if(resolved.color&&/^#[0-9a-f]{6}$/i.test(resolved.color))
    chip.style?.setProperty('--ovll-skill-ref-color',resolved.color);
  const icon=doc.createElement('span');
  icon.className='ovll-skill-ref-icon';
  const glyph=svgLibrary?.get?.(resolved.iconKey||'');
  if(typeof glyph==='string'&&glyph.startsWith('<svg')){
    // This HTML comes only from the app-owned SVG library, never the model.
    icon.innerHTML=glyph;
    icon.querySelector?.('svg')?.classList?.add('svg-icon');
  }
  const title=doc.createElement('span');
  title.className='ovll-skill-ref-label';
  title.textContent=name;
  chip.append(icon,title);
  return chip;
}

function appendReference(doc,container,ref,token,{resolve,svgLibrary}){
  const found=resolveReference(resolve,ref);
  if(!found){appendText(doc,container,token);return}
  container.append(createSkillReferenceChip(doc,found,{svgLibrary}));
}
export function renderSkillReferenceText(container,text,{resolve,svgLibrary,source='user'}={}){
  const doc=container.ownerDocument;
  container.replaceChildren();
  const raw=String(text??'');
  // Literal user-typed tokens are never elevated into trusted chips.
  if(source!=='assistant'){appendText(doc,container,raw);return container}
  for(const piece of segmentSkillReferences(raw)){
    if(piece.type==='candidate')
      appendReference(doc,container,piece.reference,piece.token,{resolve,svgLibrary});
    else appendText(doc,container,piece.text);
  }
  return container;
}
export function renderSkillReferenceParts(container,parts,{resolve,svgLibrary}={}){
  const doc=container.ownerDocument;
  container.replaceChildren();
  if(!Array.isArray(parts))throw new TypeError('INVALID_SKILL_REFERENCE_PARTS');
  for(const part of parts){
    if(part?.type==='text'){appendText(doc,container,part.text);continue}
    if(part?.type==='reference'&&part.reference){
      let token;
      try{token=serializeSkillReference(part.reference)}
      catch{appendText(doc,container,String(part.token||part.text||''));continue}
      appendReference(doc,container,part.reference,token,{resolve,svgLibrary});
      continue;
    }
    appendText(doc,container,String(part?.text||part?.token||''));
  }
  return container;
}
