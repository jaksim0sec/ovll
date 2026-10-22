/** Live-provider, single-request prototype; never synthesize a successful response. */
import {createRequestRegistry} from './request/registry.js';
import {createRequestScheduler} from './request/scheduler.js';
import {createPromptComposer} from './engine/promptComposer.js';
import {createMemoryDataProvider} from './engine/dataProvider.js';
import {createRequestEngine} from './engine/engine.js';
import {createGeminiCaller} from './model/gemini.js';

async function main(){
  const {GEMINI_API_KEY:apiKey,GEMINI_MODEL:model}=process.env;
  if(!apiKey||!model)throw new Error('Set GEMINI_API_KEY and GEMINI_MODEL to run the live Gemini demo.');
  const engine=createRequestEngine({composer:createPromptComposer(),dataProvider:createMemoryDataProvider(),modelCaller:createGeminiCaller({apiKey,model})});
  const scheduler=createRequestScheduler({registry:createRequestRegistry(),execute:(record,options)=>engine.run(record,options)});
  const job=scheduler.enqueue({roomId:'prototype-room',request:{parts:[{type:'text',text:'안녕하세요. 간단히 인사해주세요.'}],attachments:[]},
    contextData:{overallFlow:'',currentTopic:'',details:''},initialResources:[]});
  const outcome=await job.completion;
  console.log(JSON.stringify({roomId:outcome.roomId,requestId:outcome.requestId,status:outcome.status,currentLayer:outcome.currentLayer,
    ...(outcome.result?{result:outcome.result}:{}),...(outcome.error?{error:outcome.error}:{})},null,2));
  if(outcome.status!=='completed')process.exitCode=1;
}
main().catch(error=>{console.error(error.message==='Set GEMINI_API_KEY and GEMINI_MODEL to run the live Gemini demo.'?error.message:'Prototype execution failed; inspect the request state and provider configuration.');process.exitCode=2;});
