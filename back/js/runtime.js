/** Beta runtime composition. One Engine, one authoritative room asset store, one HTTP boundary. */
import {createPromptComposer} from './engine/promptComposer.js';
import {createMemoryDataProvider} from './engine/dataProvider.js';
import {createEngine} from './engine/engine.js';
import {createConfiguredGeminiCaller} from './model/configuredGemini.js';
import {createMemorySessions} from './request/memorySessions.js';
import {createMemoryActionStore} from './assets/memoryActionStore.js';
import {createRequestHttpServer,resolveTestToken} from './httpServer.js';

export function createBetaRuntime({
 composer=createPromptComposer(),
 modelCaller=createConfiguredGeminiCaller(),
 assets=createMemoryActionStore(),
 sessions=createMemorySessions(),
 testToken=resolveTestToken()
}={}){
 // Mutating actions require an explicit, nontrivial private beta token. The legacy 'abcd' remains read-only.
 const writable=typeof testToken==='string'&&testToken.length>=16&&testToken!=='abcd';
 const engine=createEngine({composer,modelCaller,dataProvider:createMemoryDataProvider({assets}),actionStore:writable?assets:undefined,sessions});
 const server=createRequestHttpServer({scheduler:engine,sessions,assets,testToken});
 return Object.freeze({engine,assets,sessions,server});
}
