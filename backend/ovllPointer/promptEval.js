// Evaluates proposed planner structure, never claims that work actually executed.
export const PROMPT_EVAL_CASES=Object.freeze([
 {id:'chat',fixture:'empty',requestText:'Explain what a reusable AI workflow is in one sentence.'},
 {id:'new-kind',fixture:'empty',requestText:'Create a new kind of reusable node for checking source reliability. Do not run it.'},
 {id:'edit-only',fixture:'writer',requestText:'Edit the existing writing node request to give shorter answers. Do not run it.'},
 {id:'reuse-run',fixture:'writer',requestText:'Use the existing writing node to draft a short explanation now.'},
 {id:'compose-run',fixture:'empty',requestText:'Add a writing node to the graph and run that new node to draft a short report.'},
 {id:'pdf-export',fixture:'research',requestText:'Export the existing research result as a PDF. Use its real result rather than creating a substitute source.'}
]);
const actions=turn=>Array.isArray(turn?.actions)?turn.actions:[];
const patches=list=>list.filter(a=>a?.kind==='ir.applyPatch'&&a.args?.patch&&typeof a.args.patch==='object');
const ops=a=>Array.isArray(a?.args?.patch?.operations)?a.args.patch.operations:[];
const defs=a=>Array.isArray(a?.args?.patch?.definitions)?a.args.patch.definitions:[];
const targets=a=>Array.isArray(a?.args?.targets)?a.args.targets:[];
const hasRun=list=>list.some(a=>['run.start','function.run','run.retry'].includes(a?.kind));
const linked=(list,p,key)=>list.some(a=>a?.kind==='run.start'&&a.dependsOn?.includes(p.localKey)&&
  targets(a).some(t=>t.fromAction===p.localKey&&t.localNodeKey===key));
export function promptEvalSnapshot(id){
 const c=PROMPT_EVAL_CASES.find(x=>x.id===id);
 if(!c)throw Error('UNKNOWN_EVAL_SCENARIO');
 const ref=c.fixture==='writer'?'builtin:write':c.fixture==='research'?'builtin:research':null;
 const nodeId=c.fixture==='writer'?'existing-write':'existing-research';
 return {graph:{graphId:'g_eval',revision:0,connections:[],nodes:ref?
   [{nodeId,definitionRef:{definitionId:ref,version:1},settings:{request:'Use existing context'},inputBindings:{}}]:[]},definitions:[]};
}
export function promptEvalExtra(id){
 return id==='pdf-export'?{availableResults:{items:[{nodeId:'existing-research',resultCurrent:true,
  valueRef:'eval-existing-result',outputs:{result:{inline:'Existing sourced research notes.'}}}]}}:{};
}
export function gradePromptEvalTurn(id,turn){
 if(!PROMPT_EVAL_CASES.some(x=>x.id===id))throw Error('UNKNOWN_EVAL_SCENARIO');
 const a=actions(turn),p=patches(a),reasons=[];
 const require=(condition,code)=>{if(!condition)reasons.push(code)};
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
 }
 return {id,pass:reasons.length===0,reasons,
  actionKinds:a.map(x=>['ir.applyPatch','run.start','function.save','function.run'].includes(x?.kind)?x.kind:'other'),
  proposedOnly:true};
}
