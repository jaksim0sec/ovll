import {MODEL_CONTEXT_LIMITS,jsonBytes} from './contextLimits.js';
import {PRODUCT_COMMUNICATION_RULES} from '../ai/productInstructions.js';
import { readFileSync } from 'node:fs';
import { KernelError } from './graph.js';
import { createContractValidation } from './validation.js';
import { assertJsonValue } from './nodeOutput.js';

const fail = code => { throw new KernelError(code, code, 422); };
const registryURL = new URL('../../instructions/registry.json', import.meta.url);
const instructionsURL = new URL('../../instructions/', import.meta.url);

export function createPromptComposer({validation=createContractValidation()}={}) {
  if(typeof validation?.validate!=='function')fail('PROMPT_VALIDATION_REQUIRED');
  const registry=JSON.parse(readFileSync(registryURL,'utf8')),modules=new Map();
  if(!Array.isArray(registry.modules)||typeof registry.assemblyVersion!=='string')fail('INVALID_PROMPT_REGISTRY');
  for(const item of registry.modules) {
    if(typeof item?.id!=='string'||!/^[a-z][a-z0-9.-]*$/.test(item.id)||
      typeof item.path!=='string'||!/^prompts\/[a-zA-Z0-9/._-]+\.md$/.test(item.path)||
      item.path.split('/').includes('..')||!Number.isInteger(item.order)||!Number.isInteger(item.version)||
      !Array.isArray(item.requires)||modules.has(item.id))fail('INVALID_PROMPT_REGISTRY');
    const content=readFileSync(new URL(item.path,instructionsURL),'utf8').trim();
    if(!content||Buffer.byteLength(content,'utf8')>16000)fail('INVALID_PROMPT_MODULE');
    modules.set(item.id,{...item,content});
  }
  if(!modules.has('core')||modules.get('core').order!==0)fail('INVALID_PROMPT_REGISTRY');
  for(const item of modules.values())
    for(const id of item.requires)
      if(!modules.has(id)||modules.get(id).order>=item.order)fail('INVALID_PROMPT_DEPENDENCY');
  function assemble({moduleIds=['layer.entry'],context,nodeContext,extraContext}={}) {
    if(!validation.validate('ContextBundle',context))fail('INVALID_CONTEXT_BUNDLE');
    if(!Array.isArray(moduleIds)||moduleIds.some(id=>typeof id!=='string'||!modules.has(id)))fail('UNKNOWN_PROMPT_MODULE');
    if(nodeContext!==undefined) {
      assertJsonValue(nodeContext);
      if(!nodeContext||Array.isArray(nodeContext)||typeof nodeContext!=='object')fail('INVALID_NODE_CONTEXT');
    }
    if(extraContext!==undefined)assertJsonValue(extraContext);
    const selected=new Set(['core']);
    function include(id){if(selected.has(id))return;for(const p of modules.get(id).requires)include(p);selected.add(id);}
    for(const id of moduleIds)include(id);
    const ordered=[...selected].map(id=>modules.get(id)).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
    const details=ordered.filter(x=>x.id!=='core').map(x=>x.content).join('\n\n');
    const data=JSON.stringify({context,...(nodeContext===undefined?{}:{nodeContext}),...(extraContext===undefined?{}:{extraContext})});
    if(Buffer.byteLength(data,'utf8')>MODEL_CONTEXT_LIMITS.promptDataBytes)fail('PROMPT_CONTEXT_TOO_LARGE');
    const messages=[{role:'system',content:modules.get('core').content+'\n\n'+PRODUCT_COMMUNICATION_RULES}];
    if(details||nodeContext!==undefined)messages.push({role:'developer',content:details+
      (nodeContext===undefined?'':'\n\nFor this node execution return one JSON ModelTurn containing only "outputs". Use NodeOutput produced/blocked and the exact declared output ports. Do not propose other actions or invent tool executions.')});
    messages.push({role:'user',content:data});
    if(jsonBytes(messages)>MODEL_CONTEXT_LIMITS.messageBytes)fail('PROMPT_MESSAGES_TOO_LARGE');
    return {assemblyVersion:registry.assemblyVersion,moduleIds:ordered.map(x=>x.id),messages};
  }
  return Object.freeze({assemble,assemblyVersion:registry.assemblyVersion,registryStatus:registry.status});
}
