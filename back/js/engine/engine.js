/** Provider-neutral Gate → Hallway Initial prototype. No Workshop execution. */
export function createRequestEngine({composer,modelCaller,dataProvider}={}){
  if(!composer?.compose||!modelCaller?.generate||!dataProvider?.resolveNeed)throw new TypeError('Engine ports required');
  const invalid=()=>Object.assign(new Error('Invalid engine layer output'),{code:'ENGINE_OUTPUT_INVALID'});
  const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const exact=(v,keys)=>isObj(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
  const strings=(v,keys)=>exact(v,keys)&&keys.every(k=>typeof v[k]==='string');
  const needValid=need=>Array.isArray(need)&&need.every(x=>{
    if(!Array.isArray(x)||typeof x[0]!=='string')return false;
    if(x[0]==='skillList')return x.length===1;
    if(x[0]==='skillDef'||x[0]==='canvasSkill')return x.length===2&&Array.isArray(x[1])&&x[1].every(k=>typeof k==='string'&&k.length>0);
    if(x[0]==='originalReq'||x[0]==='chatContext')return x.length===2&&Number.isSafeInteger(x[1])&&x[1]>=0;
    return false;
  });
  const blockValid=x=>strings(x,['intent','progress']);
  const dataValid=x=>strings(x,['overallFlow','currentTopic','details']);
  const allowedWorkshops=new Set(['skillDefine','skillEdit','canvasEdit','textGenerate','terminate']);
  const planValid=plan=>Array.isArray(plan)&&plan.length>0&&plan.every((step,index)=>{
    if(!isObj(step)||Object.keys(step).length!==1)return false;
    const [name]=Object.keys(step);const d=step[name];
    return allowedWorkshops.has(name)&&(name!=='terminate'||index===plan.length-1)&&isObj(d)&&exact(d,['objective','need'])&&typeof d.objective==='string'&&needValid(d.need);
  });
  async function call(layer,context){
    const prompt=await composer.compose(layer,{languageSettings:'',interfaceSyntax:''});
    const raw=await modelCaller.generate({layer,prompt,context,format:'json'});
    try {return JSON.parse(raw.jsonText);}catch {throw invalid();}
  }
  async function run(snapshot,{onStage=()=>{}}={}){
    if(!snapshot?.request||!Array.isArray(snapshot.initialResources)||typeof onStage!=='function')throw invalid();
    const request=structuredClone(snapshot.request);
    const contextData=structuredClone(snapshot.contextData);
    const initialResources=structuredClone(snapshot.initialResources);
    const gate=await call('gate',{userRequest:request,contextData,initialResources});
    if(!exact(gate,['need'])||!needValid(gate.need))throw invalid();
    const lookup=await dataProvider.resolveNeed({roomId:snapshot.roomId,requestId:snapshot.requestId,need:gate.need,availableResources:initialResources,request,contextData});
    if(!Array.isArray(lookup?.resources)||!Array.isArray(lookup?.missing))throw invalid();
    if(lookup.missing.length)throw Object.assign(new Error('Required data unavailable'),{code:'DATA_UNAVAILABLE'});
    onStage('hallwayInitial');
    const result=await call('hallwayInitial',{userRequest:request,contextData,resources:lookup.resources});
    if(exact(result,['languageBlock','contextBlock','contextData'])&&typeof result.languageBlock==='string'&&result.languageBlock.trim()&&blockValid(result.contextBlock)&&dataValid(result.contextData))
      return {status:'completed',currentLayer:'hallwayInitial',result:{languageBlock:result.languageBlock},contextBlock:result.contextBlock,contextData:result.contextData};
    if(exact(result,['plan','contextBlock'])&&planValid(result.plan)&&blockValid(result.contextBlock))
      return {status:'unsupported_workshop',currentLayer:'hallwayInitial',plan:result.plan,contextBlock:result.contextBlock};
    throw invalid();
  }
  return Object.freeze({run});
}
