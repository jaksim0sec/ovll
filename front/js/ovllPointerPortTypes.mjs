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

// Declared semantic ports also carry ordering in existing graphs. Reserved controls
// exist independently of data ports; an absent arbitrary name is never a control.
export function isFlowPort(definition, name, direction){
  if(typeof name!=='string')return false;
  return (definition?.[direction]||[]).some(p=>p.name===name)||
    (direction==='outputs'?/^(next|flow_next_*)$/:/^(in|flow_in_*)$/).test(name);
}
