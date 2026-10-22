/** Render Web Service entry: one origin serves both beta UI and request APIs. */
import {createRequestRegistry} from './request/registry.js';
import {createRequestScheduler} from './request/scheduler.js';
import {createPromptComposer} from './engine/promptComposer.js';
import {createMemoryDataProvider} from './engine/dataProvider.js';
import {createRequestEngine} from './engine/engine.js';
import {createGeminiCaller} from './model/gemini.js';
import {createRequestHttpServer} from './httpServer.js';

const {GEMINI_API_KEY,GEMINI_MODEL,OVLL_TEST_TOKEN}=process.env;
if(!GEMINI_API_KEY||!GEMINI_MODEL||!OVLL_TEST_TOKEN||OVLL_TEST_TOKEN.length<16){
 console.error('Render beta requires GEMINI_API_KEY, GEMINI_MODEL and OVLL_TEST_TOKEN (16+ characters).');
 process.exitCode=1;
}else{
 const engine=createRequestEngine({composer:createPromptComposer(),dataProvider:createMemoryDataProvider(),modelCaller:createGeminiCaller({apiKey:GEMINI_API_KEY,model:GEMINI_MODEL})});
 const scheduler=createRequestScheduler({registry:createRequestRegistry(),execute:(record,options)=>engine.run(record,options)});
 const server=createRequestHttpServer({scheduler,testToken:OVLL_TEST_TOKEN});
 const port=Number(process.env.PORT)||10000;
 server.listen(port,'0.0.0.0',()=>console.log('Ovll beta HTTP test service listening on '+port));
}
