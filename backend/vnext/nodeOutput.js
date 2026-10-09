import { KernelError } from './graph.js';
const fail=code=>{throw new KernelError(code);};
export function assertJsonValue(value,depth=0){
  if(depth>12)fail('NODE_VALUE_TOO_DEEP');
  if(value===null||typeof value==='string'||typeof value==='boolean')return;
  if(typeof value==='number'){if(!Number.isFinite(value))fail('NODE_VALUE_NOT_JSON');return;}
  if(!value||typeof value!=='object'||(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype))fail('NODE_VALUE_NOT_JSON');
  for(const v of Object.values(value))assertJsonValue(v,depth+1);
}
export async function validateValue(representation,value,validateRepresentation){
  assertJsonValue(value);
  if(Buffer.byteLength(JSON.stringify(value),'utf8')>32768)fail('NODE_OUTPUT_TOO_LARGE');
  let valid;
  if(['text','structured_text','document'].includes(representation))valid=typeof value==='string';
  else if(representation==='boolean')valid=typeof value==='boolean';
  else if(representation==='number')valid=typeof value==='number';
  else if(representation==='json')valid=true;
  else if(representation==='object')valid=value!==null&&typeof value==='object'&&!Array.isArray(value);
  else if(representation==='array')valid=Array.isArray(value);
  else {
    if(typeof validateRepresentation!=='function')fail('REPRESENTATION_VALIDATOR_REQUIRED');
    valid=await validateRepresentation({representation,value});
  }
  if(valid!==true)fail('OUTPUT_REPRESENTATION_MISMATCH');
}
export async function validateNodeOutput(definition,response,{inputArtifacts=[],validateRepresentation}={}){
  if(!response||typeof response!=='object'||Array.isArray(response)||Object.keys(response).some(k=>!['status','values','reason'].includes(k)))fail('NODE_OUTPUT_CONTRACT');
  assertJsonValue(response);
  if(Buffer.byteLength(JSON.stringify(response),'utf8')>32768)fail('NODE_OUTPUT_TOO_LARGE');
  if(response.reason!==undefined&&(typeof response.reason!=='string'||!response.reason.trim()||response.reason.length>2400))fail('NODE_OUTPUT_CONTRACT');
  if(response.status==='blocked'){
    if(!response.reason||response.values!==undefined)fail('NODE_OUTPUT_CONTRACT');
    return {blocked:true,reason:response.reason};
  }
  const values=response.values;
  if(response.status!=='produced'||!values||typeof values!=='object'||Array.isArray(values))fail('NODE_OUTPUT_CONTRACT');
  const names=Object.keys(values),declared=new Map(definition.outputs.map(p=>[p.name,p]));
  if(!names.length||names.length>64)fail('NODE_OUTPUT_CONTRACT');
  for(const port of declared.values())if(port.required===true&&!Object.hasOwn(values,port.name))fail('REQUIRED_OUTPUT_MISSING');
  const result=[];
  for(const name of names){
    const port=declared.get(name),wrapper=values[name];
    if(!port)fail('UNKNOWN_OUTPUT_PORT');
    if(!wrapper||typeof wrapper!=='object'||Array.isArray(wrapper)||Object.keys(wrapper).length!==1)fail('NODE_OUTPUT_CONTRACT');
    let value,sourceRefs=[];
    if(Object.hasOwn(wrapper,'inline'))value=wrapper.inline;
    else if(Object.hasOwn(wrapper,'ref')){
      const input=inputArtifacts.find(v=>v.valueRef===wrapper.ref);
      if(!input||typeof wrapper.ref!=='string'||wrapper.ref.length>160)fail('OUTPUT_REFERENCE_NOT_AVAILABLE');
      if(input.representation!==port.representation)fail('OUTPUT_REPRESENTATION_MISMATCH');
      value=input.value;sourceRefs=[input.valueRef];
    }else fail('NODE_OUTPUT_CONTRACT');
    await validateValue(port.representation,value,validateRepresentation);
    result.push({port,value,sourceRefs});
  }
  return result;
}
