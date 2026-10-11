import {iconSvg} from './nodeCatalog.js';
import {PATCH_OPERATION_KINDS,PATCH_OPERATION_CONTRACTS} from './validation.js';
export function canonicalTurnExample(){
  return {executionIntent:'requested',actions:[
    {localKey:'p',kind:'ir.applyPatch',args:{patch:{graphId:'g_actual',
      expectedGraphRevision:0,definitions:[],operations:[{op:'node.add',
      localNodeKey:'n',definitionRef:{definitionId:'builtin:write',version:1},
      settings:{request:'Write the requested report'}}]}}},
    {localKey:'r',kind:'run.start',dependsOn:['p'],
      args:{targets:[{fromAction:'p',localNodeKey:'n'}],damMode:'closed'}}]};
}
export function toWireTurnExample(turn=canonicalTurnExample()){
  return {executionIntent:turn.executionIntent??null,message:turn.message??null,
    actions:(turn.actions||[]).map(a=>({localKey:a.localKey,kind:a.kind,argsJson:JSON.stringify(a.args),dependsOn:a.dependsOn||[]})),
    needs:(turn.needs||[]).map(n=>({kind:n.kind,selectorJson:JSON.stringify(n.selector),purpose:n.purpose}))};
}
export function canonicalTurnExamples(){
 const empty={graph:{graphId:'g_actual',revision:0,nodes:[],connections:[]},definitions:[]};
 const writer={...empty,graph:{...empty.graph,nodes:[{nodeId:'existing-write',
  definitionRef:{definitionId:'builtin:write',version:1},settings:{request:'Write a report'},inputBindings:{}}]}};
 return [
  {id:'chat',requestText:'Explain reusable workflows in one sentence.',snapshot:empty,
   turn:{message:'A reusable workflow preserves a useful procedure so it can work with new inputs.'}},
  {id:'edit-only',requestText:'Shorten the existing writer request. Do not run it.',snapshot:writer,
   turn:{actions:[{localKey:'p',kind:'ir.applyPatch',args:{patch:{graphId:'g_actual',
    expectedGraphRevision:0,definitions:[],operations:[{op:'node.update',nodeId:'existing-write',
     settings:{request:'Write a short report'}}]}}}]}},
  {id:'new-kind',requestText:'Create a new kind of node for source reliability. Do not run it.',snapshot:empty,
   turn:{actions:[{localKey:'p',kind:'ir.applyPatch',args:{patch:{graphId:'g_actual',expectedGraphRevision:0,
    definitions:[{localKey:'d',purpose:'Assess source reliability',executorKind:'model_task',
     instruction:'Assess supplied evidence, source reliability and limitations.',
     inputs:[{name:'in',role:'evidence',representation:'json',required:false}],
     outputs:[{name:'result',role:'assessment',representation:'json'}]}],
    operations:[{op:'node.add',localNodeKey:'n',definitionRef:{localDefinitionKey:'d'}}]}}}]}},
  {id:'compose-run',requestText:'Add a writer and run it to produce a report.',snapshot:empty,
   turn:canonicalTurnExample()}
 ];
}
export function localModelContract(nodeContext,{wire=false}={}){
 if(nodeContext)return [
  'Return one JSON ModelTurn containing ONLY outputs: {"outputs":{"status":"produced","values":{"result":{"inline":"answer"}}}}.',
  'Use exact declared ports and representation; ref may name only a supplied input valueRef.',
  'An exclusive branch produces exactly one branch port.',
  'Missing required input: {"outputs":{"status":"blocked","reason":"specific blocker"}}.',
  'No actions or fabricated tool effects.'
 ].join('\n');
 return [
  '# OUTPUT — '+(wire?'provider wire':'canonical ModelTurn'),
  wire?
   'Return executionIntent:"requested"|null, message:string|null, actions:[], needs:[]. Keep required null/empty wire fields.':
   'Emit only needed message, actions, needs and executionIntent. Actions use args objects.',
  wire?
   'Each action has localKey, kind, argsJson and dependsOn:[]. argsJson = JSON.stringify(canonical action.args). For ir.applyPatch it encodes {"patch":{GraphPatch}}, never a bare GraphPatch.':
   'ir.applyPatch action.args is {"patch":{GraphPatch}}, with the GraphPatch inside args.patch.',
  wire?'Each need has kind, selectorJson:JSON.stringify(selector), purpose.':'Each need has kind, selector and purpose.',
  '# REFERENCES — declarations and uses',
  '| Thing | Declare | Refer to it |',
  '| Action in this turn | actions[].localKey | dependsOn[]; target.fromAction |',
  '| New definition in this patch | patch.definitions[].localKey | definitionRef:{localDefinitionKey:"d"} |',
  '| Existing definition | actual definitionId and version | definitionRef:{definitionId,version} |',
  '| New node in this patch | node.add.localNodeKey | endpoint.node:{localNodeKey}; target:{fromAction,localNodeKey} |',
  '| Existing node | actual nodeId | node.update.nodeId; endpoint.node:{nodeId}; target:{nodeId} |',
  '| New link in this patch | link.add.localLinkKey | patch-local link handle |',
  'Action keys are turn-local. Definition/node/link handles are patch-local; applied createdRefs provide persistent IDs.',
  '# PATCH — schema fields',
  'GraphPatch requires actual graphId, expectedGraphRevision, definitions and operations.',
  ...PATCH_OPERATION_KINDS.map(k=>k+'('+PATCH_OPERATION_CONTRACTS[k].required.filter(x=>x!=='op').join(',')+'): fields '+PATCH_OPERATION_CONTRACTS[k].fields.filter(x=>x!=='op').join(',')+'.'),
  'A DefinitionDraft declares localKey, purpose and instruction.',
  'Ordinary model_task drafts default executorKind and optional flexible JSON in/result ports.',
  'Explicit ports require name, role and representation.',
  'presentation may contain name, iconKey and color (#RRGGBB).',
  'Icon keys: '+Object.keys(iconSvg).join(', ')+'.',
  'Unknown icon names use the custom icon; never emit SVG markup or invented icon identifiers.',
  '# RUN — target and dependency fields',
  'New target: {fromAction:"p",localNodeKey:"n"}; the run action dependsOn includes its producer patch key "p".',
  'Existing target: {nodeId:"actual-id"}. Default damMode is closed.',
  '# SAVED ACTIONS — field shapes',
  'function.run uses functionRef and fresh inputBindings.',
  'function.save args.function requires purpose, inputs, outputs, invariants and procedure.',
  'procedure is {kind:"model_task",instruction} or {kind:"graph",graphRef:{graphId,revision}}.',
  'Graph inputMap/outputMap bind named ports to actual nodeId/port; apply EXTRACT for semantic matching.',
  '# EXAMPLES — independent requests, not a sequence',
  'Example refs belong only to each supplied fixture. Use the actual context refs for real work.',
  ...canonicalTurnExamples().flatMap(e=>[
   'Example '+e.id+' request: '+e.requestText,
   'Fixture: '+JSON.stringify(e.snapshot.graph),
   JSON.stringify(wire?toWireTurnExample(e.turn):e.turn)
  ])
 ].join('\n');
}
// Provider projection: closed envelopes avoid the domain schema's oneOf/conditionals
// and unconstrained object keys. JSON payloads are decoded, then domain-validated.
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const nullable=schema=>({anyOf:[schema,{type:'null'}]});
const string={type:'string'};
export function phaseWireContract(phase,nodeContext){
 let schema,guidance;
 if(phase==='response'){
  schema=object({message:string});guidance='Response phase: return only {"message":"user-facing explanation grounded in ActionResults"}. No actions, needs or outputs.';
 }else if(phase==='node'){
  const ports=nodeContext.outputPorts.map(p=>p.name);
  schema=object({status:{type:'string',enum:['produced','blocked']},values:{type:'array',items:object({port:{type:'string',enum:ports},valueJson:nullable(string),ref:nullable(string)})},reason:nullable(string)});
  guidance='Node wire phase: return {status:"produced"|"blocked",values:[{port:exact_declared_port,valueJson:JSON.stringify(actual_value),ref:null}],reason:null}. For a supplied valueRef use ref and valueJson:null. Blocked uses values:[] and a specific reason. Do not duplicate ports. No actions or message.';
 }else{
  schema=object({executionIntent:nullable({type:'string',enum:['requested']}),message:nullable(string),actions:{type:'array',items:object({localKey:string,kind:{type:'string',enum:['ir.applyPatch','run.start','run.revise','run.cancel','run.retry','function.save','question.ask','task.complete','function.run']},argsJson:string,dependsOn:{type:'array',items:string}})},needs:{type:'array',items:object({kind:string,selectorJson:string,purpose:string})}});
  guidance='Turn wire phase: use the provider wire envelope described in OUTPUT. Required null/empty fields are stripped by the decoder; nested action args and need selectors remain JSON strings.';
 }
 return {name:'ovll_'+phase,schema,guidance};
}
export function decodePhaseOutput(value,phase){
 if(!value||typeof value!=='object'||Array.isArray(value))return value;
 const {_meta:ignored,...domain}=value;
 if(phase==='node'&&typeof domain.status==='string'&&Array.isArray(domain.values)){
  if(Object.keys(domain).some(k=>!['status','values','reason'].includes(k))||!Object.hasOwn(domain,'reason'))throw Error('INVALID_NODE_WIRE_FIELDS');
  const values={};for(const item of domain.values){
   if(!item||Object.keys(item).some(k=>!['port','valueJson','ref'].includes(k))||typeof item.port!=='string'||!Object.hasOwn(item,'valueJson')||!Object.hasOwn(item,'ref')||item.valueJson===null&&item.ref===null||item.valueJson!==null&&typeof item.valueJson!=='string'||item.ref!==null&&typeof item.ref!=='string')throw Error('INVALID_NODE_WIRE_VALUE');
   if(Object.hasOwn(values,item.port))throw Error('DUPLICATE_OUTPUT_PORT');
   if(item.valueJson!==null&&item.ref!==null)throw Error('AMBIGUOUS_OUTPUT_VALUE');
   values[item.port]=item.ref!==null?{ref:item.ref}:{inline:JSON.parse(item.valueJson)};
  }
  return {outputs:{status:domain.status,...(domain.status==='produced'?{values}:{}),...(domain.reason!==null?{reason:domain.reason}:{})}};
 }
 if(phase==='turn'){
  if(domain.executionIntent===null)delete domain.executionIntent;
   if(domain.message===null)delete domain.message;
  if(domain.actions?.length===0)delete domain.actions;
  if(domain.needs?.length===0)delete domain.needs;
  if(Array.isArray(domain.actions))domain.actions=domain.actions.map(action=>{
   if(!Object.hasOwn(action,'argsJson'))return action;
   const {argsJson,...rest}=action;if(rest.dependsOn?.length===0)delete rest.dependsOn;return {...rest,args:JSON.parse(argsJson)};
  });
  if(Array.isArray(domain.needs))domain.needs=domain.needs.map(need=>{
   if(!Object.hasOwn(need,'selectorJson'))return need;
   const {selectorJson,...rest}=need;return {...rest,selector:JSON.parse(selectorJson)};
  });
 }
 return domain;
}
export function phaseOutputIssues(turn,phase){
 if(phase==='response'&&(typeof turn?.message!=='string'||!turn.message.trim()||turn.actions||turn.needs||turn.outputs))return [{path:'/',rule:'responseMessageOnly'}];
 if(phase==='node'&&(!turn?.outputs||turn.actions||turn.needs||turn.message))return [{path:'/',rule:'nodeOutputsOnly'}];
 if(phase==='turn'&&(turn?.outputs||turn?.needs?.length&&turn?.actions?.length))return [{path:'/',rule:'turnActionsOrNeeds'}];
 if(phase==='turn'&&turn?.actions?.some(a=>['run.start','function.run','run.retry'].includes(a.kind))&&turn.executionIntent!=='requested')
   return [{path:'/executionIntent',rule:'explicitExecutionRequired'}];
 return [];
}
