import {iconSvg} from './nodeCatalog.js';
// Vendor-neutral wire guidance supplements JSON mode; schema validation remains authoritative.
export function localModelContract(nodeContext){
  if(nodeContext)return 'Return one JSON ModelTurn containing ONLY outputs: {"outputs":{"status":"produced","values":{"result":{"inline":"answer"}}}}. Use exact declared ports and representation; ref may name only a supplied input valueRef. An exclusive branch produces exactly one branch port. Missing required input: {"outputs":{"status":"blocked","reason":"specific blocker"}}. No actions or fabricated tool effects.';
  return `Return one JSON ModelTurn: message?, actions?, needs?, executionIntent?; no markdown or other top-level fields. Chat: {"message":"answer"}. Actions are proposals, not confirmed effects.
Determine the smallest useful action from the graph snapshot BEFORE proposing any new definition: (1) run an already matching instance, (2) reuse and connect existing instances, (3) add an instance referring to an existing compatible definition, (4) define a new reusable operation ONLY if none can meet the requested behavior. Compare purpose, instruction and IO; do not substitute an unrelated builtin just to avoid definition creation. If the user explicitly requests a new kind of node, create its definition plus an instance. A concrete work request authorizes necessary internal structuring to achieve its result; use direct chat when sufficient, and define only missing reusable behavior when useful. Preserve explicit no-run and no-edit intent. Capability questions or explanations alone authorize no edits. Saving or deleting unrelated work requires authorization. Corrections override previous misunderstandings. GraphPatch + explicitly requested run example (replace graphId/revision and request): {"executionIntent":"requested","actions":[{"localKey":"p","kind":"ir.applyPatch","args":{"patch":{"graphId":"g_actual","expectedGraphRevision":0,"definitions":[],"operations":[{"op":"node.add","localNodeKey":"n","definitionRef":{"definitionId":"builtin:write","version":1},"settings":{"request":"Write the requested report"}}]}}},{"localKey":"r","kind":"run.start","dependsOn":["p"],"args":{"targets":[{"fromAction":"p","localNodeKey":"n"}],"damMode":"closed"}}]}.
Every node.add requires a unique localNodeKey (patch-scoped string) and a definitionRef; never substitute nodeId for localNodeKey. To reuse an existing definition, set definitions:[] and node.add with definitionRef:{definitionId:"d_existing",version:1}. Existing instances use their actual nodeId, without node.add. Create useful custom work when no definition fits: definitions:[{"localKey":"d","purpose":"Repeatable evidence-preserving summary","instruction":"Summarize supplied material and retain citations","presentation":{"name":"Evidence summary"}}]; model_task, optional JSON in/result ports are defaults. Provide explicit IO/representations only when useful; if declared, ports require name,role,representation (missing role/representation in model_task drafts default to the name/json). node.add uses definitionRef:{"localDefinitionKey":"d"}. Required inputs need inputBindings or data links. New link endpoints: {"node":{"localNodeKey":"n"},"port":"result"}; existing: {"node":{"nodeId":"actual_id"},"port":"source"}. Use json for built-in data ports. Flow controls order; data delivers values. New definitions may use presentation:{name,iconKey,color}; omit iconKey unless needed. Choose iconKey ONLY from the current server icon catalog: ${Object.keys(iconSvg).join(', ')}. Unknown icon names use the default custom icon; never write SVG markup or Lucide class names. Color is #RRGGBB.
For an edit of instances, connections, or definitions—including a copy—emit only the graph edit; it does not license execution. The current user turn, never a prior task objective, determines whether execution was requested. For a request to use that node, run.start targets its actual nodeId without creating a duplicate. Execute only when the current user requests a computed result or a run, and then set top-level executionIntent:"requested". Never set executionIntent just to justify an unrequested run. A request to delete one of two redundant custom definitions is an actual graph edit, not a promise. To remove an unused definition, emit ir.applyPatch with graphId, expectedGraphRevision, definitions:[], operations:[{"op":"definition.delete","definitionRef":{"definitionId":"d_actual","version":1}}]. If referenced by nodes in this graph, first remove their links and nodes in that SAME patch, then definition.delete; never remove unrelated work. If other conversations use the definition, deletion is rejected and the user must be told what blocks it. Builtin definitions are read-only: never delete, supersede or change their presentation; you may edit an instance's settings. To rename an existing custom definition use definitions:[] and operations:[{"op":"definition.appearance","definitionRef":{"definitionId":"d_actual","version":1},"presentation":{"name":"일본어 단어장"}}]; only the changed appearance fields are needed, other behavior and IO remain unchanged in the same definitionId/version; only the graph revision advances. Never add a title suffix the user asked to remove. If you cannot make a valid patch, say no change occurred and ask what is needed; NEVER say to wait, promise future actions, or claim a deletion without returned action results. Choose terminal targets covering deliverables; depend on patches before resolving temporary targets. Tool tasks use only supplied file.read_local/artifact.create capabilities; the runtime executes them, not the model. No live browsing capability is supplied. Put current inputs/requests on instances; definitions retain repeatable rules. File input requires actual supplied content; artifact.create exports finished contents. Do not force file nodes or file-output contracts on unrelated model tasks: flexible JSON ports carry text/structured data, and only an actual downloadable file requires artifact.create.
Existing-result export: extraContext.availableResults lists current result refs and bounded previews; use needs kind:value with the exact ref for omitted contents. To export an existing node's work, reuse that source instance and add a data link from its declared output to the export input, then run the export target. Do not create a disconnected replacement research node or copy a preview into a fake result. Example link.add: {"op":"link.add","localLinkKey":"source_to_pdf","kind":"data","from":{"node":{"nodeId":"actual_source"},"port":"result"},"to":{"node":{"localNodeKey":"pdf"},"port":"in"}}. The export node uses builtin:createFile, settings.request naming the requested PDF, and no inputBindings.in when that port has a data link. A literal and a data link on one input are competing producers: clear the replaced literal with node.update in the same patch. A flow edge orders execution but supplies no contents. Exporting supplied chat text directly may bind the actual complete text without a source node. Never infer success from a node's presence or claim PDF/file completion without confirmed artifact.create results. The UI uses runtime artifact objects for cards/previews; do not manufacture /api/artifacts URLs in message or model outputs.
Saved replay: {"localKey":"f","kind":"function.run","args":{"functionRef":"fn_actual","inputBindings":{"saved_input_name":"new material"}}}. Save only when authorized: function.save args.function has purpose,inputs,outputs,invariants,procedure:{kind:"graph",graphRef:{graphId,revision}} or procedure:{kind:"model_task",instruction}. Graph IO names map unambiguously to exposed ports; optional inputMap maps input name to {nodeId,port,kind?}; kind:"file" binds a fresh file object into that source instance. A new graph revision must be confirmed before graph saving; do not guess it. Local versions remain drafts and cannot overwrite saved refs.
For essential missing facts use needs:[{kind:"definition",selector:{scope:"ref",ref:"actual_id",depth:"semantic",limit:5},purpose:"missing fact"}] without actions. Local reads use current conversation facts only. ActionResults are evidence; failures block dependent actions. After blocked work, make a scoped correction or ask for the missing input; never replay unknown file effects.`;
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
  guidance='Turn wire phase: use {executionIntent:"requested"|null,message:string|null,actions:[],needs:[]}. executionIntent:"requested" ONLY when the current user requests executing work or producing an executed result. Null for graph edits, copies, renames and structure-only requests. No run.start/function.run if null. Each action uses {localKey,kind,argsJson:JSON.stringify(canonical_args),dependsOn:[]}; each need uses {kind,selectorJson:JSON.stringify(selector),purpose}. Empty optional collections and null message are removed before canonical ModelTurn validation. argsJson retains the full canonical GraphPatch/dynamic definitions; do not flatten its fields. needs excludes actions.';
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
