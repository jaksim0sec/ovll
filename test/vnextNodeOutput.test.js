import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNodeOutput } from '../backend/vnext/nodeOutput.js';
const definition={outputs:[{name:'result',role:'result',representation:'text',required:true}]};
const produced=value=>({status:'produced',values:{result:{inline:value}}});
test('frozen NodeOutput inline values validate against declared required ports',async()=>{
 assert.deepEqual(await validateNodeOutput(definition,produced('ok')), [{port:definition.outputs[0],value:'ok',sourceRefs:[]}]);
});
test('undeclared ports, missing required output and draft output maps are refused',async()=>{
 for(const response of [{outputs:{result:'x'}},{status:'produced',values:{other:{inline:'x'}}},{status:'produced',values:{}}])
  await assert.rejects(validateNodeOutput(definition,response));
});
test('blocked output is distinguished from produced or failed work',async()=>{
 assert.deepEqual(await validateNodeOutput(definition,{status:'blocked',reason:'Need source'}),{blocked:true,reason:'Need source'});
});
test('unknown representation requires an explicit trusted validator',async()=>{
 const d={outputs:[{name:'result',representation:'table'}]};
 await assert.rejects(validateNodeOutput(d,produced({rows:[]})),e=>e.code==='REPRESENTATION_VALIDATOR_REQUIRED');
 const result=await validateNodeOutput(d,produced({rows:[]}),{validateRepresentation:async({value})=>Array.isArray(value.rows)});
 assert.deepEqual(result[0].value,{rows:[]});
});
test('nonfinite numbers, excessive nesting and oversized values cannot be stored',async()=>{
 const d={outputs:[{name:'result',representation:'json'}]};
 let deep={};for(let i=0;i<15;i++)deep={next:deep};
 for(const value of [NaN,{x:undefined},deep,'a'.repeat(32769)]) await assert.rejects(validateNodeOutput(d,produced(value)));
});
test('reference output resolves only permitted actual input artifacts and preserves source',async()=>{
 const response={status:'produced',values:{result:{ref:'v1'}}};
 await assert.rejects(validateNodeOutput(definition,response),e=>e.code==='OUTPUT_REFERENCE_NOT_AVAILABLE');
 const result=await validateNodeOutput(definition,response,{inputArtifacts:[{valueRef:'v1',representation:'text',value:'source'}]});
 assert.equal(result[0].value,'source');assert.deepEqual(result[0].sourceRefs,['v1']);
});
