/** Native function declarations are data, not executable model-owned functions. */
const icons=new Set(['play','globe','notebook','scales','pen','folder','sparkle']);
const types=new Set(['any','research','structured','decision','document','file','text']);
const idPattern=/^[a-z][A-Za-z0-9_-]{0,31}$/;
const fail=()=>{throw Object.assign(new Error('Invalid Workshop arguments'),{code:'ACTION_ARGS_INVALID'});};
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,allowed,required=allowed)=>{
 if(!obj(v)||Object.keys(v).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(v,k)))fail();
};
const str=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.length<=max;
const clone=v=>structuredClone(v);
function ports(values){
 if(!Array.isArray(values)||values.length>8)fail();
 const found=new Set();
 for(const p of values){
  keys(p,['id','label','type','multiple']);
  if(!idPattern.test(p.id)||!str(p.label,1,80)||!types.has(p.type)||typeof p.multiple!=='boolean'||found.has(p.id))fail();
  found.add(p.id);
 }
}
function fields(values){
 if(!Array.isArray(values)||values.length>8)fail();
 const found=new Set();
 for(const f of values){
  keys(f,['id','label','placeholder','default','maxLength']);
  if(!idPattern.test(f.id)||!str(f.label,1,80)||typeof f.placeholder!=='string'||f.placeholder.length>180||
     typeof f.default!=='string'||!Number.isSafeInteger(f.maxLength)||f.maxLength<1||f.maxLength>1800||f.default.length>f.maxLength||found.has(f.id))fail();
  found.add(f.id);
 }
}
export function validateSkillDefinition(args){
 keys(args,['name','description','instruction','icon','color','inputs','outputs','fields']);
 if(!str(args.name,1,80)||!str(args.description,1,280)||!str(args.instruction,1,4000)||!icons.has(args.icon)||!/^#[0-9A-Fa-f]{6}$/.test(args.color))fail();
 ports(args.inputs);ports(args.outputs);fields(args.fields);
 return clone(args);
}
export function validateBlockPlacement(args,state){
 keys(args,['skillId','x','y','expanded','values']);
 const skill=state?.skills?.find(s=>s.id===args.skillId);
 if(!skill||!Number.isFinite(args.x)||!Number.isFinite(args.y)||Math.abs(args.x)>100000||Math.abs(args.y)>100000||
    typeof args.expanded!=='boolean'||!obj(args.values))fail();
 for(const [key,value] of Object.entries(args.values)){
  const f=skill.fields?.find(field=>field.id===key);
  if(!f||typeof value!=='string'||value.length>f.maxLength)fail();
 }
 return clone(args);
}
const portSchema={type:'object',properties:{
 id:{type:'string'},label:{type:'string'},type:{type:'string',enum:[...types]},multiple:{type:'boolean'}
},required:['id','label','type','multiple']};
const fieldSchema={type:'object',properties:{
 id:{type:'string'},label:{type:'string'},placeholder:{type:'string'},default:{type:'string'},maxLength:{type:'integer'}
},required:['id','label','placeholder','default','maxLength']};
const defineTool={
 name:'define_direct',
 description:'Propose the complete definition of a reusable Skill. This declaration does not run the Skill.',
 inputSchema:{type:'object',properties:{
 name:{type:'string'},description:{type:'string'},instruction:{type:'string'},icon:{type:'string',enum:[...icons]},
 color:{type:'string'},inputs:{type:'array',items:portSchema},outputs:{type:'array',items:portSchema},
 fields:{type:'array',items:fieldSchema}
 },required:['name','description','instruction','icon','color','inputs','outputs','fields']}
};
const addTool={
 name:'add_block',description:'Propose a Canvas Skill Block referencing an already confirmed Skill ID.',
 inputSchema:{type:'object',properties:{
 skillId:{type:'string'},x:{type:'number'},y:{type:'number'},expanded:{type:'boolean'},
 values:{type:'object',additionalProperties:{type:'string'}}
 },required:['skillId','x','y','expanded','values']}
};
const descriptors=Object.freeze({
 'skillDefine.defineDirect':Object.freeze({action:'skillDefine.defineDirect',promptLayer:'workshop.skillDefine.defineDirect',tool:defineTool,validateArgs:validateSkillDefinition}),
 'canvasEdit.addBlock':Object.freeze({action:'canvasEdit.addBlock',promptLayer:'workshop.canvasEdit.addBlock',tool:addTool,validateArgs:validateBlockPlacement})
});
export function getActionDescriptor(action){return descriptors[action]??null;}
