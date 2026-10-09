import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContractValidation } from '../backend/vnext/validation.js';
const validation=createContractValidation();
const cases=JSON.parse(readFileSync(new URL('../docs/architecture/DATA_CONTRACT_PROPOSAL_V1.cases.json',import.meta.url))).cases;
for(const c of cases)test('frozen schema fixture: '+c.name,()=>assert.equal(validation.validate(c.target,c.data),c.valid));
test('runtime envelope rejects bytes, depth, cycles and non-JSON values before schema traversal',()=>{
 assert.equal(validation.validateTurn({message:'가'.repeat(11000)}),false);
 let value={};for(let n=0;n<14;n++)value={nested:value};
 assert.equal(validation.validate('NodeOutput',{status:'produced',values:{result:{inline:value}}}),false);
 const cycle={};cycle.self=cycle;
 assert.equal(validation.validateTurn(cycle),false);
 assert.equal(validation.validate('NodeOutput',{status:'produced',values:{result:{inline:NaN}}}),false);
});
test('validation never mutates or silently coerces original model values',()=>{
 const v={message:4};assert.equal(validation.validateTurn(v),false);assert.deepEqual(v,{message:4});
 assert.equal(validation.validateTurn({message:'ok',actorRef:'forged'}),false);
});
