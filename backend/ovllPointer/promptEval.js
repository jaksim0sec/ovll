// Evaluates proposed planner structure, never claims that work actually executed.
export const PROMPT_EVAL_CASES=Object.freeze([
 {id:'chat',fixture:'empty',requestText:'Explain what a reusable AI workflow is in one sentence.'},
 {id:'new-kind',fixture:'empty',requestText:'Create a new kind of reusable node for checking source reliability. Do not run it.'},
 {id:'edit-only',fixture:'writer',requestText:'Edit the existing writing node request to give shorter answers. Do not run it.'},
 {id:'reuse-run',fixture:'writer',requestText:'Use the existing writing node to draft a short explanation now.'},
 {id:'compose-run',fixture:'empty',requestText:'Add a writing node to the graph and run that new node to draft a short report.'},
 {id:'pdf-export',fixture:'research',requestText:'Export the existing research result as a PDF. Use its real result rather than creating a substitute source.'},
 {id:'explain-save',fixture:'empty',requestText:'Explain a repeatable source reliability review and save it as a model_task function with fresh source inputs. Do not run it.'},
 {id:'new-kind-run',fixture:'research',requestText:'Define a new kind of source reliability node, connect the existing research result to it, and run that new node.'},
 {id:'multi-source',fixture:'multi-source',requestText:'Run the existing reviewer with both already-connected sources. Keep the existing nodes and connections.'},
 {id:'read-before-plan',fixture:'empty',requestText:'Prepare to reuse the saved-review function with new sources. Read its missing contract before planning; do not run or edit anything.'}
]);
const actions=turn=>Array.isArray(turn?.actions)?turn.actions:[];
const patches=list=>list.filter(a=>a?.kind==='ir.applyPatch'&&a.args?.patch&&typeof a.args.patch==='object');
const ops=a=>Array.isArray(a?.args?.patch?.operations)?a.args.patch.operations:[];
const defs=a=>Array.isArray(a?.args?.patch?.definitions)?a.args.patch.definitions:[];
const targets=a=>Array.isArray(a?.args?.targets)?a.args.targets:[];
const hasRun=list=>list.some(a=>['run.start','function.run','run.retry'].includes(a?.kind));
const linked=(list,p,key)=>list.some(a=>a?.kind==='run.start'&&a.dependsOn?.includes(p.localKey)&&
  targets(a).some(t=>t.fromAction===p.localKey&&t.localNodeKey===key));
// Scenario bounds are evaluation expectations, not product action restrictions.
const onlyKeys=(value,allowed)=>Object.keys(value||{}).every(key=>allowed.includes(key));
const requestEdit=o=>o.op==='node.update'&&o.nodeId==='existing-write'&&
 onlyKeys(o,['op','nodeId','settings'])&&onlyKeys(o.settings,['request']);
function withinScenarioScope(id,list){
 const p=patches(list),runs=list.filter(a=>a?.kind==='run.start');
 const exactlyRun=test=>runs.length===1&&targets(runs[0]).length===1&&test(targets(runs[0])[0]);
 const newNode=(patch,requiredDefinition)=>{
  const nodes=ops(patch).filter(o=>o.op==='node.add');
  return nodes.length===1&&(!requiredDefinition||nodes[0].definitionRef?.definitionId===requiredDefinition)?nodes[0]:null;
 };
 const createdRun=(patch,node)=>exactlyRun(t=>t.fromAction===patch.localKey&&t.localNodeKey===node.localNodeKey);
 if(id==='chat'||id==='read-before-plan')return list.length===0;
 if(id==='explain-save')return list.length===1&&list[0]?.kind==='function.save';
 if(id==='multi-source')return list.length===1&&exactlyRun(t=>t.nodeId==='existing-review');
 if(id==='reuse-run')return p.length<=1&&list.length===p.length+1&&exactlyRun(t=>t.nodeId==='existing-write')&&
  p.every(x=>defs(x).length===0&&ops(x).length===1&&ops(x).every(requestEdit));
 if(p.length!==1)return false;
 const patch=p[0],operations=ops(patch),definitions=defs(patch);
 if(definitions.some(d=>d?.supersedes))return false;
 if(id==='edit-only')return list.length===1&&definitions.length===0&&operations.length===1&&operations.every(requestEdit);
 const node=newNode(patch,id==='pdf-export'?'builtin:createFile':null);
 if(!node)return false;
 if(id==='new-kind'||id==='new-kind-run'){
  if(definitions.length!==1||node.definitionRef?.localDefinitionKey!==definitions[0].localKey)return false;
 }else if(id==='pdf-export'?definitions.length!==0:definitions.length>1||
  definitions.length===1&&node.definitionRef?.localDefinitionKey!==definitions[0].localKey)return false;
 if(id==='new-kind')return list.length===1&&operations.length===1;
 if(list.length!==2||!createdRun(patch,node))return false;
 if(id==='compose-run')return operations.length===1;
 const links=operations.filter(o=>o.op==='link.add');
 return operations.length===2&&links.length===1&&links[0].kind==='data'&&
  links[0].from?.node?.nodeId==='existing-research'&&links[0].to?.node?.localNodeKey===node.localNodeKey;
}
export function promptEvalSnapshot(id){
 const c=PROMPT_EVAL_CASES.find(x=>x.id===id);
 if(!c)throw Error('UNKNOWN_EVAL_SCENARIO');
 if(c.fixture==='multi-source')return {graph:{graphId:'g_eval',revision:0,nodes:[
  ...['source-a','source-b'].map(nodeId=>({nodeId,definitionRef:{definitionId:'builtin:research',version:1},settings:{request:'Preserve the supplied source'},inputBindings:{}})),
  {nodeId:'existing-review',definitionRef:{definitionId:'eval-review',version:1},settings:{},inputBindings:{}}
 ],connections:['source-a','source-b'].map((nodeId,i)=>({id:'source-link-'+i,kind:'data',
  from:{nodeId,port:'result'},to:{nodeId:'existing-review',port:'in'}}))},definitions:[{
   definitionId:'eval-review',version:1,purpose:'Review all supplied sources',executorKind:'model_task',
   instruction:'Review each source and retain its evidence.',inputs:[{name:'in',role:'sources',representation:'json',multiple:true}],
   outputs:[{name:'result',role:'review',representation:'json'}]
  }]};
 const ref=c.fixture==='writer'?'builtin:write':c.fixture==='research'?'builtin:research':null;
 const nodeId=c.fixture==='writer'?'existing-write':'existing-research';
 return {graph:{graphId:'g_eval',revision:0,connections:[],nodes:ref?
   [{nodeId,definitionRef:{definitionId:ref,version:1},settings:{request:'Use existing context'},inputBindings:{}}]:[]},definitions:[]};
}
export function promptEvalExtra(id){
 if(['pdf-export','new-kind-run','multi-source'].includes(id)){
  const sources=id==='multi-source'?['source-a','source-b']:['existing-research'];
  return {availableResults:{items:sources.map((nodeId,i)=>{
   const runId='eval_'+nodeId.replace(/-/g,'_');
   return {nodeId,runId,status:'success',resultCurrent:true,outputs:[{port:'result',
    ref:'local:'+runId+':'+nodeId+':result',
    preview:JSON.stringify(id==='multi-source'?'Source '+(i+1)+' evidence.':'Existing sourced research notes.'),truncated:false}],outputsTotal:1};
  }),total:sources.length,truncated:false}};
 }
 if(id==='read-before-plan')return {savedFunctions:[{id:'saved-review',version:1,purpose:'Review source reliability',
  inputsTotal:1,outputsTotal:1,invariantsAvailable:true,fixedInputsAvailable:false,
  contractRef:'saved-review',contractAvailable:true,contractTruncated:true}]};
 return {};
}
export function gradePromptEvalTurn(id,turn){
 if(!PROMPT_EVAL_CASES.some(x=>x.id===id))throw Error('UNKNOWN_EVAL_SCENARIO');
 const a=actions(turn),p=patches(a),reasons=[];
 const require=(condition,code)=>{if(!condition)reasons.push(code)};
 const allowed=id==='explain-save'?['function.save']:id==='chat'||id==='read-before-plan'?[]:
  id==='multi-source'?['run.start']:['ir.applyPatch','run.start'];
 require(a.every(x=>allowed.includes(x?.kind)),'UNREQUESTED_ACTION');
 require(withinScenarioScope(id,a),'UNREQUESTED_SCOPE');
 if(id!=='read-before-plan')require(!turn?.needs?.length,'UNEXPECTED_READ');
 const noRun=!hasRun(a)&&turn?.executionIntent!=='requested';
 const authorized=hasRun(a)&&turn?.executionIntent==='requested';
 if(id==='chat'){
  require(typeof turn?.message==='string'&&!!turn.message.trim(),'DIRECT_REPLY_MISSING');
  require(a.length===0&&noRun&&!turn?.needs?.length,'UNEXPECTED_ACTION');
 }else if(id==='new-kind'){
  require(p.some(x=>defs(x).some(d=>typeof d?.localKey==='string'&&
    ops(x).some(o=>o.op==='node.add'&&o.definitionRef?.localDefinitionKey===d.localKey))),
    'NEW_DEFINITION_INSTANCE_MISSING');
  require(noRun,'UNAUTHORIZED_EXECUTION');
 }else if(id==='edit-only'){
  require(p.some(x=>ops(x).some(o=>o.op==='node.update'&&o.nodeId==='existing-write')),
    'EXISTING_NODE_EDIT_MISSING');
  require(noRun,'UNAUTHORIZED_EXECUTION');
 }else if(id==='reuse-run'){
  require(authorized&&a.some(x=>x.kind==='run.start'&&targets(x).some(t=>t.nodeId==='existing-write')),
    'EXISTING_RUN_MISSING');
  require(p.every(x=>defs(x).length===0&&ops(x).every(o=>o.op!=='node.add')),'UNNECESSARY_NEW_NODE');
 }else if(id==='compose-run'){
  require(authorized&&p.some(x=>ops(x).some(o=>o.op==='node.add'&&
    typeof o.localNodeKey==='string'&&linked(a,x,o.localNodeKey))),'NEW_NODE_NOT_LINKED_TO_RUN');
 }else if(id==='pdf-export'){
  require(authorized&&p.some(x=>ops(x).some(o=>o.op==='node.add'&&
    o.definitionRef?.definitionId==='builtin:createFile'&&typeof o.localNodeKey==='string'&&
    ops(x).some(e=>e.op==='link.add'&&e.kind==='data'&&
      e.from?.node?.nodeId==='existing-research'&&e.to?.node?.localNodeKey===o.localNodeKey)&&
    linked(a,x,o.localNodeKey))),'PDF_SOURCE_LINK_OR_RUN_MISSING');
  require(p.every(x=>ops(x).every(o=>o.op!=='node.add'||o.definitionRef?.definitionId!=='builtin:research')),
    'SOURCE_RECREATED');
 }else if(id==='explain-save'){
  require(typeof turn?.message==='string'&&!!turn.message.trim(),'EXPLANATION_MISSING');
  require(a.some(x=>x.kind==='function.save'&&x.args?.function?.procedure?.kind==='model_task'),
   'MODEL_TASK_SAVE_MISSING');
  require(noRun,'UNAUTHORIZED_EXECUTION');
 }else if(id==='new-kind-run'){
  require(authorized&&p.some(x=>defs(x).some(d=>ops(x).some(o=>o.op==='node.add'&&
   o.definitionRef?.localDefinitionKey===d.localKey&&linked(a,x,o.localNodeKey)&&
   ops(x).some(e=>e.op==='link.add'&&e.kind==='data'&&e.from?.node?.nodeId==='existing-research'&&
    e.from.port==='result'&&e.to?.node?.localNodeKey===o.localNodeKey&&d.inputs?.some(port=>port.name===e.to.port))))),
   'NEW_KIND_SOURCE_LINK_OR_RUN_MISSING');
  require(p.every(x=>ops(x).every(o=>o.op!=='node.add'||o.definitionRef?.definitionId!=='builtin:research')),'SOURCE_RECREATED');
 }else if(id==='multi-source'){
  require(authorized&&a.some(x=>x.kind==='run.start'&&targets(x).some(t=>t.nodeId==='existing-review')),
   'EXISTING_REVIEW_RUN_MISSING');
  require(p.length===0,'SOURCE_CONNECTION_CHANGED');
 }else if(id==='read-before-plan'){
  require(a.length===0&&noRun,'UNAUTHORIZED_ACTION');
  require(turn?.needs?.some(n=>n.kind==='contract'&&n.selector?.scope==='ref'&&n.selector.ref==='saved-review'&&n.selector.depth==='full'),
   'SAVED_CONTRACT_READ_MISSING');
  require(turn?.needs?.length===1,'UNREQUESTED_READ');
 }
 return {id,pass:reasons.length===0,reasons,
  actionKinds:a.map(x=>['ir.applyPatch','run.start','function.save','function.run'].includes(x?.kind)?x.kind:'other'),
  proposedOnly:true};
}
