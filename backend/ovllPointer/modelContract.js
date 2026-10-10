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
export function localModelContract(nodeContext,{wire=false}={}){
  if(nodeContext)return 'Return one JSON ModelTurn containing ONLY outputs: {"outputs":{"status":"produced","values":{"result":{"inline":"answer"}}}}. Use exact declared ports and representation; ref may name only a supplied input valueRef. An exclusive branch produces exactly one branch port. Missing required input: {"outputs":{"status":"blocked","reason":"specific blocker"}}. No actions or fabricated tool effects.';
  return [
    '# DECIDE — current user turn',
    'Answer directly when sufficient; concrete work may use necessary internal structuring. Preserve explicit no-run and no-edit requests. Capability questions do not authorize edits.',
    'First reuse matching existing instances; then existing compatible definition and its instances. Define a new reusable operation ONLY if none fits or a new node kind is explicitly requested. A new kind means new definition plus instance, not builtin:write disguised by renaming.',
    '# IR — meaning and real references',
    'GraphPatch requires actual graphId/expectedGraphRevision and definitions/operations. Supported operations: '+PATCH_OPERATION_KINDS.map(k=>k+'('+PATCH_OPERATION_CONTRACTS[k].required.filter(x=>x!=='op').join(',')+')').join('; ')+'.',
    'Canonical ir.applyPatch args: {"patch":{"graphId":"g","expectedGraphRevision":0,"definitions":[],"operations":[]}}. node.add requires unique localNodeKey and definitionRef. Existing node uses nodeId; existing definition uses definitionRef:{definitionId,version}. New definition uses localKey, purpose, instruction; refer to it with definitionRef:{localDefinitionKey:"d"}.',
    'Definitions retain reusable purpose, instruction and semantic IO, while instance settings/inputBindings carry current inputs. model_task defaults to optional JSON in/result ports; custom explicit ports require name,role,representation. presentation may have name,iconKey,color (#RRGGBB); icon keys: '+Object.keys(iconSvg).join(', ')+'. Unknown icon names use the custom icon; never output SVG markup or invented icon identifiers.',
    'Data links transfer actual source values; flow links order work but provide no data. New endpoints use localNodeKey, existing ones nodeId. A literal inputBinding and data link on the same port conflict. file.read_local reads supplied real content, artifact.create exports a file; never forge /api/artifacts URLs, effects or absent capabilities.',
    '# EXECUTION — authorization and truth',
    'Edits, renames, copies and deletes do not authorize run.start. Set executionIntent:"requested" only for an explicit run or computed result requested by the current turn. Respect explicit no-run intent. Newly created targets use {fromAction,localNodeKey} and depend on the producer patch via dependsOn; existing targets use nodeId. Default damMode closed. Model proposals are not ActionResults. Node success, run completion and task completion are different facts.',
    'Existing-result export: use extraContext.availableResults and exact refs, requesting needs when contents are omitted. Connect the actual existing source output by data link to builtin:createFile input, then run that target; never fabricate a replacement upstream node or substitute a preview. Report delivered files only from confirmed artifact.create results.',
    '# EDITS AND SAVED FUNCTIONS',
    'Custom cosmetic changes use ir.applyPatch.args.patch.operations definition.appearance with exact definitionRef and only changed presentation. Builtin definitions are read-only. Unused custom definition deletion uses definition.delete, removing authorized dependent local links/nodes in the same patch. Other conversations may block deletion; never claim unconfirmed changes.',
    'function.run uses saved functionRef and fresh inputBindings. function.save requires authorization and semantic inputs/outputs/invariants with a confirmed graph or model_task procedure; never guess an uncommitted revision. Missing essential information uses needs without actions; after blocked execution do not invent effects.',
    '# OUTPUT — '+(wire?'provider wire':'canonical ModelTurn'),
    wire?'argsJson is JSON.stringify(the canonical action.args object), not GraphPatch. For ir.applyPatch it contains {"patch":{GraphPatch}}, never a bare GraphPatch. Return required null/empty wire fields.':'Emit only canonical message?,actions?,needs?,executionIntent?; actions use args, not argsJson.',
    'Complete patch + authorized run example: '+JSON.stringify(wire?toWireTurnExample():canonicalTurnExample())
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
  guidance='Turn wire phase: output executionIntent:"requested"|null, message:string|null, actions:[], needs:[]. Each action has localKey, kind, argsJson, dependsOn:[]; argsJson = JSON.stringify(canonical action.args). For ir.applyPatch, argsJson encodes {"patch":{GraphPatch}}, NOT GraphPatch itself. Empty optional fields are stripped by the decoder. Needs have selectorJson and cannot share a turn with actions.';
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
