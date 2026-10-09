import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { assertJsonValue } from './nodeOutput.js';
const schema=JSON.parse(readFileSync(new URL('../../docs/architecture/DATA_CONTRACT_PROPOSAL_V1.schema.json',import.meta.url),'utf8'));
export function createContractValidation({maxBytes=32768}={}){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>1048576)throw new Error('INVALID_CONTRACT_BUDGET');
  // Strict mode is an Ajv-specific schema lint rule, not Draft 2020-12 validity.
  // The frozen schema's inherited required fields are intentionally left unchanged.
  const ajv=new Ajv2020({strict:false,allErrors:false,coerceTypes:false,useDefaults:false,removeAdditional:false});
  ajv.addSchema(schema);
  const validators=new Map(Object.keys(schema.$defs).map(name=>[name,ajv.getSchema(schema.$id+'#/$defs/'+name)]));
  const validate=(target,value)=>{
    if(!validators.has(target))return false;
    try{
      assertJsonValue(value);
      if(Buffer.byteLength(JSON.stringify(value),'utf8')>maxBytes)return false;
      return validators.get(target)(value)===true;
    }catch{return false;}
  };
  return {validate,validateTurn:value=>validate('ModelTurn',value)};
}
