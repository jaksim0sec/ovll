/** Single-origin beta: Gate -> Hallway -> Action shell; no Workshop actions execute. */
import {createPromptComposer} from './engine/promptComposer.js';
import {createMemoryDataProvider} from './engine/dataProvider.js';
import {createEngine} from './engine/engine.js';
import {createConfiguredGeminiCaller} from './model/configuredGemini.js';
import {createMemorySessions} from './request/memorySessions.js';
import {createRequestHttpServer,resolveTestToken} from './httpServer.js';
const sessions=createMemorySessions();
// Empty read-only catalog: not the retired Workshop asset store, and never mutated.
const assets=Object.freeze({read:()=>({revision:0,skills:[],blocks:[],links:[]})});
const engine=createEngine({composer:createPromptComposer(),dataProvider:createMemoryDataProvider({assets}),modelCaller:createConfiguredGeminiCaller(),sessions});
const server=createRequestHttpServer({scheduler:engine,sessions,assets,testToken:resolveTestToken()});
const port=Number(process.env.PORT)||10000;
server.listen(port,'0.0.0.0',()=>console.log('Ovll beta HTTP test service listening on '+port));
