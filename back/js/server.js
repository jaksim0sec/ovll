/** Render Web Service entry: one origin serves both beta UI and request APIs. */
import {createRequestRegistry} from './request/registry.js';
import {createRequestScheduler} from './request/scheduler.js';
import {createPromptComposer} from './engine/promptComposer.js';
import {createMemoryDataProvider} from './engine/dataProvider.js';
import {createRequestEngine} from './engine/engine.js';
import {createConfiguredGeminiCaller} from './model/configuredGemini.js';
import {createRequestHttpServer,resolveTestToken} from './httpServer.js';

// Like main, missing model credentials must not prevent server startup.
const modelCaller=createConfiguredGeminiCaller();
const engine=createRequestEngine({composer:createPromptComposer(),dataProvider:createMemoryDataProvider(),modelCaller});
const scheduler=createRequestScheduler({registry:createRequestRegistry(),execute:(record,options)=>engine.run(record,options)});
const server=createRequestHttpServer({scheduler,testToken:resolveTestToken()});
const port=Number(process.env.PORT)||10000;
server.listen(port,'0.0.0.0',()=>console.log('Ovll beta HTTP test service listening on '+port));
