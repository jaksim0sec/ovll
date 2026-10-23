import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeminiCaller} from '../../back/js/model/gemini.js';
import {createConfiguredGeminiCaller} from '../../back/js/model/configuredGemini.js';

const tool={name:'define_direct',description:'Define a reusable Skill',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']}};
const response=parts=>({ok:true,json:async()=>({candidates:[{content:{parts}}]})});
const caller=fetchImpl=>createGeminiCaller({apiKey:'test-secret',model:'gemini-example',fetchImpl});
test('selected Gemini tool is declared once and normalized as a proposal',async()=>{
 let sent;
 const gemini=caller(async (url,init)=>{sent={url,init,body:JSON.parse(init.body)};return response([{functionCall:{name:'define_direct',args:{name:'식물 조사'}}}]);});
 const got=await gemini.generateFunction({prompt:'Define a Skill',context:{objective:'식물'},tool});
 assert.deepEqual(got,{kind:'function_proposal',name:'define_direct',args:{name:'식물 조사'}});
 assert.equal(sent.body.tools[0].functionDeclarations.length,1);
 assert.equal(sent.body.tools[0].functionDeclarations[0].name,'define_direct');
 assert.equal(sent.body.toolConfig.functionCallingConfig.mode,'ANY');
 assert.deepEqual(sent.body.toolConfig.functionCallingConfig.allowedFunctionNames,['define_direct']);
 assert.equal('responseMimeType' in (sent.body.generationConfig??{}),false);
 assert.equal(JSON.stringify(sent.body).includes('test-secret'),false);
});
test('zero, multiple, foreign and non-object calls are rejected',async()=>{
 for(const parts of [[],[{text:'done'}],[{functionCall:{name:'other',args:{}}}],
  [{functionCall:{name:'define_direct',args:{}}},{functionCall:{name:'define_direct',args:{}}}],
  [{functionCall:{name:'define_direct',args:'text'}}]]){
  const gemini=caller(async()=>response(parts));
  await assert.rejects(gemini.generateFunction({prompt:'Define a Skill',context:{},tool}),e=>e.code==='MODEL_INVALID_RESPONSE');
 }
});
test('provider failures are sanitized and configured caller exposes the function method',async()=>{
 const unauthorized=caller(async()=>({ok:false,status:403}));
 await assert.rejects(unauthorized.generateFunction({prompt:'Do it',context:{},tool}),e=>e.code==='MODEL_AUTH');
 const configured=createConfiguredGeminiCaller({env:{GEMINI_API_KEY:'test-secret',GEMINI_MODEL:'gemini-example'},fetchImpl:async()=>response([{functionCall:{name:'define_direct',args:{name:'Test'}}}])});
 assert.deepEqual(await configured.generateFunction({prompt:'Do it',context:{},tool}),{kind:'function_proposal',name:'define_direct',args:{name:'Test'}});
});

test('dynamic Canvas field values are described with JSON Schema, not OpenAPI Schema',async()=>{
 let sent;
 const gemini=caller(async (_url,init)=>{sent=JSON.parse(init.body);return response([{functionCall:{name:'add_block',args:{skillId:'skill-real',x:100,y:100,expanded:true,values:{request:'test'}}}}]);});
 const tool={name:'add_block',description:'Place a Block',
  parametersJsonSchema:{type:'object',properties:{
   skillId:{type:'string'},values:{type:'object',additionalProperties:{type:'string'}}
  },required:['skillId','values']}};
 const got=await gemini.generateFunction({prompt:'Place a block',context:{},tool});
 assert.equal(got.name,'add_block');
 const declaration=sent.tools[0].functionDeclarations[0];
 assert.equal('parameters' in declaration,false);
 assert.deepEqual(declaration.parametersJsonSchema.properties.values.additionalProperties,{type:'string'});
});

test('Gemini adapter translates provider-neutral inputSchema into a provider FunctionDeclaration',async()=>{
 let sent;
 const schema={type:'object',properties:{skillId:{type:'string'},values:{type:'object',additionalProperties:{type:'string'}}},required:['skillId','values']};
 const tool={name:'add_block',description:'Place a confirmed Skill Block',inputSchema:schema};
 const gemini=caller(async(_url,init)=>{sent=JSON.parse(init.body);return response([{functionCall:{name:'add_block',args:{skillId:'real',values:{request:'oak'}}}}]);});
 const output=await gemini.generateFunction({prompt:'Place existing Skill',context:{},tool});
 assert.equal(output.name,'add_block');
 const declared=sent.tools[0].functionDeclarations[0];
 assert.deepEqual(declared.parametersJsonSchema,schema);
 assert.equal('inputSchema' in declared,false);
 assert.equal('parameters' in declared,false);
});
