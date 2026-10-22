/** Live-provider, single-request prototype; never synthesize a successful response. */
import {createRequestRegistry} from './request/registry.js';
import {createRequestScheduler} from './request/scheduler.js';
import {createPromptComposer} from './engine/promptComposer.js';
import {createMemoryDataProvider} from './engine/dataProvider.js';
import {createRequestEngine} from './engine/engine.js';
import {createConfiguredGeminiCaller} from './model/configuredGemini.js';

async function main(){
  const engine=createRequestEngine({composer:createPromptComposer(),dataProvider:createMemoryDataProvider(),modelCaller:createConfiguredGeminiCaller()});
  const scheduler=createRequestScheduler({registry:createRequestRegistry(),execute:(record,options)=>engine.run(record,options)});
  const job=scheduler.enqueue({roomId:'prototype-room',request:{parts:[{type:'text',text:'안녕하세요. 간단히 인사해주세요.'}],attachments:[]},
    contextData:{overallFlow:'',currentTopic:'',details:''},initialResources:[]});
  const outcome=await job.completion;
  console.log(JSON.stringify({roomId:outcome.roomId,requestId:outcome.requestId,status:outcome.status,currentLayer:outcome.currentLayer,
    ...(outcome.result?{result:outcome.result}:{}),...(outcome.error?{error:outcome.error}:{})},null,2));
  if(outcome.status!=='completed')process.exitCode=1;
}
main().catch(error=>{console.error('Prototype execution failed; inspect the request state and provider configuration.');process.exitCode=2;});
