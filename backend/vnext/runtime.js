import { createContractValidation } from './validation.js';
import { PostgresVNextStore } from './durable.js';
import { createDurableVNextApp } from './durableHttp.js';
import { createRunWorker } from './worker.js';
import { createNodeExecution,verifyNodeRunEvidence } from './nodeExecution.js';
import { createPromptComposer } from './promptComposer.js';
import { createModelNodeExecutor } from './modelExecutor.js';
import { createTurnController } from './turnController.js';
export function createVNextRuntime({pool,executeNode,workerRef,authenticate,verifyMutation,
  verifyTaskOutcomes,maxTaskValidationMs=5000,authorizeCapabilities,validateNodeOutput,validateRepresentation,executionProfileId='v1',
  maxNodes=512,maxNodeMs=60000,maxRunMs=300000,maxValidationMs=5000,leaseSeconds=30,modelGateway,loadModelContext,resolveModel,onModelUsage,prepareTurnContext,resolveTurnModel,fulfillTurnNeeds,selectTurnModules,languageAfterActions=false,refineTurnProposals=true}={}){
  const validation=createContractValidation();
  const prompts=createPromptComposer({validation});
  const resolvedExecuteNode=executeNode||(modelGateway&&createModelNodeExecutor({
    gateway:modelGateway,composer:prompts,loadContext:loadModelContext,resolveModel,validation,onUsage:onModelUsage}));
  const store=new PostgresVNextStore({pool,validateTurn:validation.validateTurn,verifyTaskOutcomes,maxTaskValidationMs,
    verifyRunEvidence:context=>verifyNodeRunEvidence({...context,executionProfileId,validateRepresentation,maxValidationMs})});
  const executeRun=createNodeExecution({pool,executeNode:resolvedExecuteNode,authorizeCapabilities,validateNodeOutput,
    validateRepresentation,executionProfileId,maxNodes,maxNodeMs,maxRunMs});
  const worker=createRunWorker({store,executeRun,workerRef,leaseSeconds});
  const controller=prepareTurnContext&&createTurnController({
    store,composer:prompts,gateway:modelGateway,validation,
    prepareContext:prepareTurnContext,resolveModel:resolveTurnModel,
    fulfillNeeds:fulfillTurnNeeds,selectModules:selectTurnModules,
    languageAfterActions,refineProposals:refineTurnProposals,onUsage:onModelUsage
  });
  const app=createDurableVNextApp({store,authenticate,verifyMutation,
    handleRequest:controller?.run});
  return {store,worker,app,validation,prompts,controller};
}
