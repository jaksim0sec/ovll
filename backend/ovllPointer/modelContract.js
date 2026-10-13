import {iconSvg} from './skillCatalog.js';
import {ACTION_PLAN_CONTRACT,SEMANTIC_ACTION_FIELDS} from './actionCompiler.js';
import {SKILL_ACTION_PLAN_CONTRACT,SKILL_SEMANTIC_ACTION_FIELDS,legacySemanticKind,skillSemanticKind}
  from './skillActionContract.js';
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
const ACTION_DETAIL_MODULES=Object.freeze({
 'action.nodes':['node.add','node.update','node.delete'],
 'action.definitions':['node.define','definition.revise','definition.appearance','definition.delete'],
 'action.links':['link.add','link.remove'],
 'action.execution':['execute'],
 'action.functions':['function.save']
});
export function actionModulesForKinds(kinds=[]){
 const selected=new Set();
 for(const kind of kinds){
  const translated=legacySemanticKind(kind);
  if(!Object.hasOwn(SEMANTIC_ACTION_FIELDS,translated))throw Error('UNKNOWN_SEMANTIC_ACTION');
  for(const [id,members] of Object.entries(ACTION_DETAIL_MODULES))
    if(members.includes(translated))selected.add(id);
 }
 return [...selected];
}
export function selectionOutputIssues(value){
 const error=(path,rule)=>[{path,rule}];
 if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).some(k=>!['decision','actionKinds','message','needs'].includes(k)))
  return error('/','invalidSelection');
 if(!['answer','read','work'].includes(value.decision))return error('/decision','invalidSelectionDecision');
 if(!Array.isArray(value.actionKinds)||value.actionKinds.length>16||
    new Set(value.actionKinds).size!==value.actionKinds.length||
    value.actionKinds.some(k=>typeof k!=='string'||
      !Object.hasOwn(SEMANTIC_ACTION_FIELDS,legacySemanticKind(k))))
  return error('/actionKinds','invalidSelectedActions');
 if(value.needs!==undefined&&(!Array.isArray(value.needs)||value.needs.length>32))
  return error('/needs','invalidSelectionNeeds');
 if(value.decision==='work'&&(!value.actionKinds.length||value.needs?.length||value.message))
  return error('/actionKinds','workRequiresActionKinds');
 if(value.decision==='read'&&(!value.needs?.length||value.actionKinds.length||value.message))
  return error('/needs','readRequiresNeeds');
 if(value.decision==='answer'&&(typeof value.message!=='string'||!value.message.trim()||
    value.actionKinds.length||value.needs?.length))
  return error('/message','answerRequiresMessage');
 return [];
}
function skillModelContract(nodeContext,{wire=false,selectedModules=[],selection=false,workshop=false}={}){
 if(nodeContext)return localModelContract(nodeContext,{wire,selectedModules,selection,workshop});
 if(selection)return [
  '# CORRIDOR SELECTION — choose Skill actions, never write action payloads',
  'Return JSON decision:"answer"|"read"|"work", actionKinds:[], message:null, needs:[], taskContext:null unless work.',
  'Work selects only these semantic kinds: '+Object.keys(SKILL_SEMANTIC_ACTION_FIELDS).join(', ')+'.',
  'answer returns a complete message, read requests needed evidence, work returns chosen actionKinds and taskContext:{objective,constraints}.',
  'The host injects exact Skill action contracts before WORKSHOP. No invented execution results or keyword-only intent classifier.'
 ].join('\n');
 const selected=new Set(selectedModules),has=id=>selected.has(id);
 const out=[
  '# WORKSHOP — Skill v2 semantic action plan',
  '# OUTPUT — '+SKILL_ACTION_PLAN_CONTRACT,
  wire?'Return {contract:"action-plan.v2",executionIntent:"requested"|null,message:string|null,actions:[],needs:[]}. Each action is {action,payloadJson:JSON.stringify(semanticFields)}. Keep required null and empty wire fields.':
       'Return contract:"action-plan.v2" with actions:[{action,...semanticFields}], or needs, or a direct message.',
  'For a direct answer include the required EXIT context records. With actions/needs EXIT fields are null.',
  'For actions include taskContext:{objective,constraints:[string]}; for needs/direct answer use taskContext:null.',
  'Each need uses a grounded {kind,selector,purpose}; wire mode uses selectorJson.',
  'Only provided semantic contracts exist. Never supply internal GraphPatch fields, make up IDs or claim effects.'
 ];
 if(workshop)out.push('Use selected actions only; request additional action kinds through the host if required.');
 else out.push('Ask for the selected action contract before preparing an unfamiliar action.');
 if(selected.size){
  out.push('# SELECTED SKILL ACTION CONTRACTS');
  for(const [moduleId,kinds] of Object.entries(ACTION_DETAIL_MODULES)){
   if(!has(moduleId))continue;
   for(const legacy of kinds){
    const name=skillSemanticKind(legacy),fields=SKILL_SEMANTIC_ACTION_FIELDS[name];
    if(fields)out.push(name+': '+fields.join(', ')+'.');
   }
  }
  out.push('Skill selector: {kind:"existing",skillId:actual_id} or {kind:"created",alias:declared_alias}. Definition selector: {kind:"builtin",type:"write"}, {kind:"existing",definitionId,version?} or {kind:"created",alias}.');
 }
 if(has('action.nodes'))out.push(
  'skill.add requires alias, definition and optional request/settings/inputs. skill.update merges requested settings and optional inputs. skill.delete requires a target; removeIncidentLinks:true authorizes exact incident link removal only.'
 );
 if(has('action.definitions'))out.push(
  'skill.define requires alias, purpose and instruction; optional createInstance:true. skill.revise selects exact supersedes version. skill.appearance edits only custom presentation. skill.definition.delete removes only exact unused custom versions.',
  'presentation supports name, color and iconKey. Allowed icon keys: '+Object.keys(iconSvg).join(', ')+'. Unknown icons use custom.'
 );
 if(has('action.links'))out.push(
  'link.add uses from/to:{skill:SkillSelector,port:declared_port}; kind:data transfers values, kind:flow orders execution. link.remove uses existing linkId. Never invent ports.'
 );
 if(has('action.execution'))out.push(
  'execute requires one target or targets:[SkillSelector], never both. damMode closed ends at targets; open follows downstream flow. Function targets use {kind:"function",ref:id}. executionIntent:"requested" requires current authorization.'
 );
 if(has('action.functions'))out.push(
  'function.save retains separate Function assets. Graph inputMap/outputMap entries are {skill:SkillSelector,port} or {skillId,port}. Preserve invariants, exact inputs and outputs.'
 );
 if(has('action.nodes')&&has('action.execution'))
  out.push('Example: '+JSON.stringify({contract:SKILL_ACTION_PLAN_CONTRACT,
    executionIntent:'requested',actions:[
     {action:'skill.add',alias:'writer',definition:{kind:'builtin',type:'write'},request:'Write a report'},
     {action:'execute',target:{kind:'created',alias:'writer'},damMode:'closed'}
    ]}));
 return out.join('\n');
}
export function localModelContract(nodeContext,{wire=false,selectedModules=[],selection=false,workshop=false,skillV2=false}={}){
 if(skillV2)return skillModelContract(nodeContext,{wire,selectedModules,selection,workshop});
 if(selection)return [
  '# CORRIDOR SELECTION — decide the action kinds; do not write action payloads',
  'Return JSON with decision:"answer"|"read"|"work", actionKinds:[], message:null, needs:[], taskContext:null unless work.',
  'answer: return a complete direct message with actionKinds:[] and needs:[]; include EXIT context records.',
  'read: request actual missing task evidence through needs with actionKinds:[] and no message.',
  'work: select necessary semantic action kinds, including graph edits, dynamic definitions, execution and function saving if authorized; include taskContext:{objective,constraints}. Return no action payload, message or needs.',
  'Available kinds: '+Object.keys(SEMANTIC_ACTION_FIELDS).join(', ')+'.',
  wire?'Encode each need selector in selectorJson:JSON.stringify(selector).':'Use needs items {kind,selector,purpose}.',
  'The server supplies exact contracts to WORKSHOP after you choose. Never classify user intent with a keyword dictionary.'
 ].join('\n');
 if(nodeContext)return [
  'Return one JSON ModelTurn containing ONLY outputs: {"outputs":{"status":"produced","values":{"result":{"inline":"answer"}}}}.',
  'Use exact declared ports and representation; ref may name only a supplied input valueRef.',
  'An exclusive branch produces exactly one branch port.',
  'Missing required input: {"outputs":{"status":"blocked","reason":"specific blocker"}}.',
  'No actions or fabricated tool effects.'
 ].join('\n');
 const selected=new Set(selectedModules),has=id=>selected.has(id);
 const details=Object.entries(ACTION_DETAIL_MODULES).filter(([id])=>has(id));
 const out=[
  '# WORKSHOP — server-supplied action contracts required before proposing actions',
  '# OUTPUT — ActionPlan '+ACTION_PLAN_CONTRACT,
  wire?'Return contract:"action-plan.v1", executionIntent:"requested"|null, message:string|null, actions:[], needs:[]. Each action is {"action":string,"payloadJson":JSON.stringify(semanticFields)}. Keep required null/empty wire fields.':
   'Return contract:"action-plan.v1" with needed message, actions, needs and executionIntent. Each action is {action,...semanticFields}.',
  'For a final direct answer return requestDigest, responseDigest, updated sessionContext and valid explicit constraints. Preserve exact prior conditions unless current user explicitly supersedes them; list exact old strings in supersededConstraints, otherwise []. With needs/actions EXIT fields are null.',
  'For actions return taskContext:{objective, constraints:[string]} containing applicable conditions; for needs/direct answers return taskContext:null.',
  wire?'Each need is {kind,selectorJson:JSON.stringify(selector),purpose}.':'Each need is {kind,selector,purpose}.',
  ...(workshop?[
   'Generate only the selected action kinds, with the exact supplied contracts. Need actual task data? Use needs without actions; do not request technical contracts.',
   'If your work requires an additional action kind, include that action: the host will withhold all execution, inject its contract and request a fresh WORKSHOP draft.'
  ]:[
   '# ACTION DIRECTORY — READ SELECTED CONTRACTS',
   ...Object.entries(ACTION_DETAIL_MODULES).map(([id,kinds])=>'prompt:'+id+' → '+kinds.join(', ')),
   'Before unfamiliar actions, request their details using needs with kind:"contract", selector scope:"ref" and the prompt:action.* module ref.'
  ]),
  'question.ask:{question:string}. Read real graph, history, runs, function or artifact data with needs before referencing missing facts.',
  'Only listed actions exist. No invented IDs, actions, file effects or completed results.'
 ];
 if(!details.length)return out.join('\n');
 out.push('# SELECTED ACTION CONTRACTS');
 for(const [id,names] of details)out.push('## '+id,...names.map(name=>name+': '+SEMANTIC_ACTION_FIELDS[name].join(', ')+'.'));
 out.push('Node selector: {kind:"existing",nodeId:actual_id} or {kind:"created",alias:declared_alias}. Definition selector: {kind:"builtin",type:"write"} or {kind:"existing",definitionId,version?} or {kind:"created",alias}. Declare aliases before use.');
 if(has('action.nodes'))out.push(
  'node.add requires alias, definition and optional request/settings/inputs; node.update merges requested settings and replaces inputs only if given. node.delete requires a target; removeIncidentLinks:true authorizes removing incident links only.'
 );
 if(has('action.definitions'))out.push(
  'node.define requires alias, purpose and instruction; createInstance:true creates an instance. Ordinary model_task may omit executorKind and ports using flexible JSON in/result defaults. Explicit ports require name, role, representation; preserve required/multiple.',
  'tool_task requires capabilities and explicit IO; subgraph requires procedureRef. definition.revise requires alias, exact supersedes selector and complete new contract; definition.appearance changes only requested metadata of custom definitions; builtins are read-only. definition.delete removes only exact unused custom versions.',
  'presentation contains name, iconKey, color (#RRGGBB). Icon keys: '+Object.keys(iconSvg).join(', ')+'. Unknown icons use custom.'
 );
 if(has('action.links'))out.push(
  'link.add uses kind:data|flow and from/to:{node:NodeSelector,port:exact_port}. Data transfers values and creates upstream dependency; flow orders execution. Avoid synthetic data ports for sequencing. link.remove requires actual linkId.'
 );
 if(has('action.execution'))out.push(
  'execute requires target OR targets:[NodeSelector], never both. Default damMode:closed ends at targets; open also follows downstream flow. Function execute uses target:{kind:"function",ref:actual_function_id}, inputs:{named:fresh_value}. Read full contracts before binding.',
  'executionIntent:"requested" only for current authorized execution/computed deliverable, never from history or edits.'
 );
 if(has('action.functions'))out.push(
  'function.save requires function:{purpose,inputs,outputs,invariants,procedure,inputMap?,outputMap?}. Procedure is {kind:"model_task",instruction} or {kind:"graph"}. Host supplies graph reference.',
  'Graph inputMap/outputMap use {node:NodeSelector,port} or {nodeId,port}, matching representations. Preserve enduring rules, parameterize example inputs; saving is a draft, not verified execution.'
 );
 out.push('Put related graph edits together before execute/save/question; host applies ordered dependencies. Never claim unverified success.');
 const examples=semanticTurnExamples().filter(e=>
  e.id==='edit-only'&&has('action.nodes')||
  e.id==='new-kind'&&has('action.definitions')||
  e.id==='compose-run'&&has('action.nodes')&&has('action.execution'));
 if(examples.length)out.push('# SELECTED EXAMPLES',...examples.map(e=>e.id+': '+JSON.stringify(wire?toWireActionPlan(e.plan):e.plan)));
 return out.join('\n');
}
// Provider projection: closed envelopes avoid the domain schema's oneOf/conditionals
// and unconstrained object keys. JSON payloads are decoded, then domain-validated.
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const nullable=schema=>({anyOf:[schema,{type:'null'}]});
const string={type:'string'};
const contextFields={requestDigest:nullable(string),responseDigest:nullable(string),sessionContext:nullable(string),constraints:nullable({type:'array',items:string}),supersededConstraints:nullable({type:'array',items:string})};
export function splitContextOutput(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return {domain:value,contextRecord:null};
 const {requestDigest,responseDigest,sessionContext,constraints,supersededConstraints,taskContext,...domain}=value;
 const taskValid=taskContext==null||typeof taskContext==='object'&&!Array.isArray(taskContext)&&
  Object.keys(taskContext).every(k=>['objective','constraints'].includes(k))&&
  typeof taskContext.objective==='string'&&taskContext.objective.trim()&&taskContext.objective.length<=12000&&
  Array.isArray(taskContext.constraints)&&taskContext.constraints.length<=64&&taskContext.constraints.every(x=>typeof x==='string'&&x.trim()&&x.length<=2400)&&
  JSON.stringify(taskContext.constraints).length<=12000&&
  Buffer.byteLength(JSON.stringify(taskContext),'utf8')<=48000;
 const texts=[requestDigest,responseDigest,sessionContext];
 const retired=supersededConstraints??[];
 const valid=texts.every(x=>typeof x==='string'&&x.trim()&&x.length<=2400)&&
  Array.isArray(constraints)&&constraints.length<=64&&constraints.every(x=>typeof x==='string'&&x.trim()&&x.length<=2400)&&
  Array.isArray(retired)&&retired.length<=64&&new Set(retired).size===retired.length&&retired.every(x=>typeof x==='string'&&x.trim()&&x.length<=2400)&&
  Buffer.byteLength(JSON.stringify({requestDigest,responseDigest,sessionContext,constraints,supersededConstraints}),'utf8')<=24000;
 return {domain,contextRecord:valid?{requestDigest,responseDigest,sessionContext,constraints,...(retired.length?{supersededConstraints:retired}:{})}:null,taskContext:taskValid?taskContext:null,taskIssues:taskValid?[]:[{path:'/taskContext',rule:'invalidTaskContext'}]};
}
export function phaseWireContract(phase,nodeContext,{skillV2=false}={}){
 const kinds=skillV2?Object.keys(SKILL_SEMANTIC_ACTION_FIELDS):Object.keys(SEMANTIC_ACTION_FIELDS);
 const planContract=skillV2?SKILL_ACTION_PLAN_CONTRACT:ACTION_PLAN_CONTRACT;
 let schema,guidance;
 if(phase==='selection'){
  schema=object({decision:{type:'string',enum:['answer','read','work']},
   actionKinds:{type:'array',items:{type:'string',enum:kinds}},
   message:nullable(string),needs:{type:'array',items:object({kind:string,selectorJson:string,purpose:string})},
   taskContext:nullable(object({objective:string,constraints:{type:'array',items:string}})),...contextFields});
  guidance='Corridor selection: decision answer/read/work, actionKinds only for work; no action payloads. Needs use selectorJson. Answer returns EXIT records; work returns taskContext. The server supplies work contracts.';
 }else if(phase==='response'){
  schema=object({message:string,...contextFields});guidance='Response phase: return message grounded in ActionResults plus requestDigest, responseDigest, updated sessionContext (about two sentences) and valid explicit constraints. Keep exact previous conditions; supersededConstraints lists exact previous conditions replaced by an explicit current-user instruction, otherwise []. No actions, needs or outputs. Preserve exact facts and meaning without a fixed vocabulary.';
 }else if(phase==='node'){
  const ports=nodeContext.outputPorts.map(p=>p.name);
  schema=object({status:{type:'string',enum:['produced','blocked']},values:{type:'array',items:object({port:{type:'string',enum:ports},valueJson:nullable(string),ref:nullable(string)})},reason:nullable(string)});
  guidance='Node wire phase: return {status:"produced"|"blocked",values:[{port:exact_declared_port,valueJson:JSON.stringify(actual_value),ref:null}],reason:null}. For a supplied valueRef use ref and valueJson:null. Blocked uses values:[] and a specific reason. Do not duplicate ports. No actions or message.';
 }else{
  schema=object({contract:{type:'string',enum:[planContract]},executionIntent:nullable({type:'string',enum:['requested']}),message:nullable(string),actions:{type:'array',items:object({action:{type:'string',enum:kinds},payloadJson:string})},needs:{type:'array',items:object({kind:string,selectorJson:string,purpose:string})},taskContext:nullable(object({objective:string,constraints:{type:'array',items:string}})),...contextFields});
  guidance='Turn wire phase: use the provider wire envelope described in OUTPUT. For a final direct answer include requestDigest, responseDigest, updated sessionContext, valid explicit constraints and supersededConstraints (exact prior strings only when explicitly overridden; otherwise []). With needs/actions use null context fields. Required null/empty fields are stripped by the decoder; semantic payloads and need selectors remain JSON strings; never return internal action args.';
 }
 return {name:phase==='turn'?(skillV2?'ovll_turn_action_plan_v2':'ovll_turn_action_plan_v1'):'ovll_'+phase,schema,guidance};
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
 if(phase==='selection'){
  if(!Object.hasOwn(domain,'decision'))return decodePhaseOutput(domain,'turn');
  if(domain.message===null)delete domain.message;
  if(Array.isArray(domain.needs))domain.needs=domain.needs.map(need=>{
   if(!Object.hasOwn(need,'selectorJson'))return need;
   const {selectorJson,...rest}=need;return {...rest,selector:JSON.parse(selectorJson)};
  });
 }
 if(phase==='turn'){
  if(Object.hasOwn(domain,'contract')){
   if(![ACTION_PLAN_CONTRACT,SKILL_ACTION_PLAN_CONTRACT].includes(domain.contract))
    throw Error('UNKNOWN_ACTION_PLAN_CONTRACT');
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
