import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { assertJsonValue } from './nodeOutput.js';
const schema=JSON.parse(readFileSync(new URL('../../docs/architecture/DATA_CONTRACT_PROPOSAL_V1.schema.json',import.meta.url),'utf8'));
export function createContractValidation({maxBytes=32768,targetMaxBytes={}}={}){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>1048576)throw new Error('INVALID_CONTRACT_BUDGET');
  if(Object.values(targetMaxBytes).some(x=>!Number.isSafeInteger(x)||x<1||x>1048576))throw new Error('INVALID_CONTRACT_BUDGET');
  // Strict mode is an Ajv-specific schema lint rule, not Draft 2020-12 validity.
  // The frozen schema's inherited required fields are intentionally left unchanged.
  const ajv=new Ajv2020({strict:false,allErrors:false,coerceTypes:false,useDefaults:false,removeAdditional:false});
  ajv.addSchema(schema);
  const validators=new Map(Object.keys(schema.$defs).map(name=>[name,ajv.getSchema(schema.$id+'#/$defs/'+name)]));
  const validate=(target,value)=>{
    if(!validators.has(target))return false;
    const budget=targetMaxBytes[target]??maxBytes;
    try{
      assertJsonValue(value);
      if(Buffer.byteLength(JSON.stringify(value),'utf8')>budget)return false;
      return validators.get(target)(value)===true;
    }catch{return false;}
  };
  // Diagnose schema failures without exposing the user's text or untrusted model output.
  const explain=(target,value)=>{
    if(!validators.has(target))return [{path:'/',rule:'unknownContract'}];
    const budget=targetMaxBytes[target]??maxBytes;
    try{assertJsonValue(value);}catch{return [{path:'/',rule:'invalidJsonValue'}];}
    if(Buffer.byteLength(JSON.stringify(value),'utf8')>budget)
      return [{path:'/',rule:'maxBytes',limit:budget}];
    const validator=validators.get(target);
    if(validator(value))return [];
    return (validator.errors||[]).slice(0,8).map(error=>({
      path:error.instancePath||'/',
      rule:error.keyword,
      ...(error.keyword==='required'?{missing:error.params?.missingProperty}:{}),
      ...(error.keyword==='additionalProperties'?{extra:error.params?.additionalProperty}:{}),
      ...(error.keyword==='enum'?{allowed:error.params?.allowedValues}:{}),
      ...(error.keyword==='type'?{expected:error.params?.type}:{})
    }));
  };
  return {validate,validateTurn:value=>validate('ModelTurn',value),
    explainTurn:value=>explain('ModelTurn',value)};
}

// Host metadata is transport evidence, not part of the frozen ModelTurn domain.
export function splitModelMetadata(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return {domain:value,meta:null};
  const {_meta,...domain}=value;return {domain,meta:_meta??null};
}
