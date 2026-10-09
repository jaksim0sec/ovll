// Shared semantic IO compatibility for browser, server and execution planner.
// A JSON output may narrow only when the actual runtime value validates the input type.
const formats=new Set(['text','structured_text','document','boolean','number','object','array','json']);
export function compatibleDataRepresentation(output,input){
  if(typeof output!=='string'||typeof input!=='string')return false;
  if(output===input)return true;
  return output==='json'&&formats.has(input)||input==='json'&&formats.has(output);
}
export function matchesInputRepresentation(representation,value){
  if(['text','structured_text','document'].includes(representation))return typeof value==='string';
  if(representation==='number')return typeof value==='number'&&Number.isFinite(value);
  if(representation==='boolean')return typeof value==='boolean';
  if(representation==='object')return value!==null&&typeof value==='object'&&!Array.isArray(value);
  if(representation==='array')return Array.isArray(value);
  return true; // 'json' or a custom type already validated by its producing executor
}
