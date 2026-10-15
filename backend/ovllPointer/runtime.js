import { createContractValidation } from './validation.js';
import { PostgresPointerStore } from './durable.js';
import { createDurablePointerApp } from './durableHttp.js';
import { createRunWorker } from './worker.js';
import { createSkillNodeExecution,verifySkillNodeRunEvidence } from './skillExecution.js';
import { createPromptComposer } from './promptComposer.js';
import { createModelSkillNodeExecutor } from './modelExecutor.js';
import { createTurnController } from './turnController.js';
export function createPointerRuntime({pool,executeSkillNode,workerRef,authenticate,verifyMutation,
  verifyTaskOutcomes,maxTaskValidationMs=5000,authorizeCapabilities,validateSkillNodeOutput,validateRepresentation,executionProfileId='v1',
  maxSkillNodes=512,maxSkillNodeMs=60000,maxRunMs=300000,maxValidationMs=5000,leaseSeconds=30,modelGateway,loadModelContext,resolveModel,onModelUsage,prepareTurnContext,resolveTurnModel,fulfillTurnNeeds,selectTurnModules,languageAfterActions=false,refineTurnProposals=true}={}){
  const validation=createContractValidation();
  const prompts=createPromptComposer({validation});
  const resolvedExecuteSkillNode=executeSkillNode||(modelGateway&&createModelSkillNodeExecutor({
    gateway:modelGateway,composer:prompts,loadContext:loadModelContext,resolveModel,validation,onUsage:onModelUsage}));
  const store=new PostgresPointerStore({pool,validateTurn:validation.validateTurn,verifyTaskOutcomes,maxTaskValidationMs,
    verifyRunEvidence:context=>verifySkillNodeRunEvidence({...context,executionProfileId,validateRepresentation,maxValidationMs})});
  const executeRun=createSkillNodeExecution({pool,executeSkillNode:resolvedExecuteSkillNode,authorizeCapabilities,validateSkillNodeOutput,
    validateRepresentation,executionProfileId,maxSkillNodes,maxSkillNodeMs,maxRunMs});
  const worker=createRunWorker({store,executeRun,workerRef,leaseSeconds});
  const controller=prepareTurnContext&&createTurnController({
    store,composer:prompts,gateway:modelGateway,validation,
    prepareContext:prepareTurnContext,resolveModel:resolveTurnModel,
    fulfillNeeds:fulfillTurnNeeds,selectModules:selectTurnModules,
    languageAfterActions,refineProposals:refineTurnProposals,onUsage:onModelUsage
  });
  const app=createDurablePointerApp({store,authenticate,verifyMutation,
    handleRequest:controller?.run});
  return {store,worker,app,validation,prompts,controller};
}
