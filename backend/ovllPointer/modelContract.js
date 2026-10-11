import {iconSvg} from './nodeCatalog.js';
import {ACTION_PLAN_CONTRACT,SEMANTIC_ACTION_FIELDS} from './actionCompiler.js';
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
export function semanticTurnExamples(){
 return [
  {id:'chat',plan:{contract:ACTION_PLAN_CONTRACT,message:'A reusable workflow preserves useful work for fresh inputs.'}},
  {id:'edit-only',plan:{contract:ACTION_PLAN_CONTRACT,actions:[{action:'node.update',target:{kind:'existing',nodeId:'existing-write'},request:'Write a short report'}]}},
  {id:'new-kind',plan:{contract:ACTION_PLAN_CONTRACT,actions:[{action:'node.define',alias:'review',purpose:'Assess source reliability',instruction:'Assess supplied evidence, source reliability and limitations.',createInstance:true}]}},
  {id:'compose-run',plan:{contract:ACTION_PLAN_CONTRACT,executionIntent:'requested',actions:[{action:'node.add',alias:'report',definition:{kind:'builtin',type:'write'},request:'Write the requested report'},{action:'execute',target:{kind:'created',alias:'report'},damMode:'closed'}]}}
 ];
}
export function toWireActionPlan(plan){
 return {contract:ACTION_PLAN_CONTRACT,executionIntent:plan.executionIntent??null,message:plan.message??null,
  actions:(plan.actions||[]).map(({action,...payload})=>({action,payloadJson:JSON.stringify(payload)})),
  needs:(plan.needs||[]).map(({selector,...need})=>({...need,selectorJson:JSON.stringify(selector)}))};
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
  '# OUTPUT — ActionPlan '+ACTION_PLAN_CONTRACT,
  wire?'Return contract:"action-plan.v1", executionIntent:"requested"|null, message:string|null, actions:[], needs:[]. Each action is {action,payloadJson:JSON.stringify(the semantic fields below)}. Keep required null/empty fields.':
   'Return contract:"action-plan.v1" with only needed message, actions, needs and executionIntent. Each action is {action,...semanticFields}.',
  wire?'Each need has kind, selectorJson:JSON.stringify(selector), purpose.':'Each need has kind, selector, purpose.',
  '# ACTION FIELDS',
  ...Object.entries(SEMANTIC_ACTION_FIELDS).map(([name,fields])=>name+': '+fields.join(', ')+'.'),
  '# REFERENCES AND MEANING',
  'Node selector: {kind:"existing",nodeId:actual_id} or {kind:"created",alias:declared_alias}.',
  'Definition selector: {kind:"builtin",type:"write"} or {kind:"existing",definitionId,version?} or {kind:"created",alias}.',
  'Declare node/definition aliases before use; unique within each namespace. Never use a bare string as a node selector.',
  'node.add requires alias and an explicit definition. request/settings are instance-specific; inputs are actual named input bindings.',
  'node.update merges supplied settings/request into the selected instance and replaces inputs only when specified.',
  'node.define requires alias, purpose, instruction. createInstance:true also creates that alias as an instance; instanceInputs are its bindings.',
  'Ordinary model_task definitions may omit executorKind and ports for the existing flexible JSON in/result defaults.',
  'Explicit ports require name, role, representation; preserve required/multiple. tool_task requires capabilities and explicit IO; subgraph requires procedureRef.',
  'definition.revise requires alias, exact supersedes selector and complete purpose/instruction/executorKind/inputs/outputs.',
  'presentation contains name, iconKey and color (#RRGGBB). Icon keys: '+Object.keys(iconSvg).join(', ')+'. Unknown icons use custom.',
  'definition.appearance changes only requested metadata of an existing custom definition; builtins are read-only.',
  'definition.delete removes the exact unused custom version. Other conversations can prevent deletion.',
  'link.add requires explicit kind:data|flow and from/to:{node:NodeSelector,port:exact_port}. Data transfers values; flow orders execution.',
  'Use existing semantic ports for flow when possible; do not define next/flow data ports solely for sequencing. A data link already creates an upstream dependency; use an additional flow only for meaningful control propagation.',
  'link.remove requires actual linkId. node.delete requires target; removeIncidentLinks:true explicitly authorizes incident link removal only.',
  'Put related graph edits together before execute/save/question; they commit atomically. Use a fresh turn/state for edits after execution.',
  '# EXECUTION AND FUNCTIONS',
  'execute requires target or targets:[NodeSelector], never both. Node default damMode:closed; open also follows downstream flow.',
  'Function execute target:{kind:"function",ref:actual_function_id}, inputs:{named:fresh_value}. Read missing full contracts before binding.',
  'Use executionIntent:"requested" only for the current authorized run/computed deliverable; never infer permission from history or edits.',
  'function.save requires function:{purpose,inputs,outputs,invariants,procedure,inputMap?,outputMap?}. Preserve semantic IO and invariants.',
  'procedure:{kind:"model_task",instruction} or {kind:"graph"}; the host supplies the current graph reference for the latter.',
  'Graph inputMap/outputMap use {node:NodeSelector,port} or actual {nodeId,port}, with matching representations. The host binds created aliases to committed IDs before saving; input maps may additionally specify kind:input|file.',
  'question.ask requires question. needs discovers supplied graph, definition, history, run, contract, value or artifact data without changing it.',
  'Only the listed local actions are available. The host supplies mechanical references and dependencies. Empty actions do not complete a task.',
  '# EXAMPLES — independent requests, use actual context for real work',
  ...semanticTurnExamples().map(e=>e.id+': '+JSON.stringify(wire?toWireActionPlan(e.plan):e.plan))
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
  schema=object({contract:{type:'string',enum:[ACTION_PLAN_CONTRACT]},executionIntent:nullable({type:'string',enum:['requested']}),message:nullable(string),actions:{type:'array',items:object({action:{type:'string',enum:Object.keys(SEMANTIC_ACTION_FIELDS)},payloadJson:string})},needs:{type:'array',items:object({kind:string,selectorJson:string,purpose:string})}});
  guidance='Turn wire phase: use the provider wire envelope described in OUTPUT. Required null/empty fields are stripped by the decoder; semantic payloads and need selectors remain JSON strings; never return internal action args.';
 }
 return {name:phase==='turn'?'ovll_turn_action_plan_v1':'ovll_'+phase,schema,guidance};
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
  if(Object.hasOwn(domain,'contract')){
   if(domain.contract!==ACTION_PLAN_CONTRACT)throw Error('UNKNOWN_ACTION_PLAN_CONTRACT');
   if(Array.isArray(domain.actions))domain.actions=domain.actions.map(item=>{
    if(!Object.hasOwn(item,'payloadJson'))return item;
    if(Object.keys(item).some(k=>!['action','payloadJson'].includes(k))||typeof item.payloadJson!=='string')throw Error('INVALID_SEMANTIC_WIRE_FIELDS');
    const payload=JSON.parse(item.payloadJson);
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.hasOwn(payload,'action'))throw Error('INVALID_SEMANTIC_WIRE_PAYLOAD');
    return {action:item.action,...payload};
   });
  }
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
