import { createContractValidation } from './validation.js';
import { PostgresVNextStore } from './durable.js';
import { createDurableVNextApp } from './durableHttp.js';
import { createRunWorker } from './worker.js';
import { createNodeExecution,verifyNodeRunEvidence } from './nodeExecution.js';
export function createVNextRuntime({pool,executeNode,workerRef,authenticate,verifyMutation,
  authorizeCapabilities,validateNodeOutput,validateRepresentation,executionProfileId='v1',
  maxNodes=512,maxNodeMs=60000,maxRunMs=300000,maxValidationMs=5000,leaseSeconds=30}={}){
  const validation=createContractValidation();
  const store=new PostgresVNextStore({pool,validateTurn:validation.validateTurn,
    verifyRunEvidence:context=>verifyNodeRunEvidence({...context,executionProfileId,validateRepresentation,maxValidationMs})});
  const executeRun=createNodeExecution({pool,executeNode,authorizeCapabilities,validateNodeOutput,
    validateRepresentation,executionProfileId,maxNodes,maxNodeMs,maxRunMs});
  const worker=createRunWorker({store,executeRun,workerRef,leaseSeconds});
  const app=createDurableVNextApp({store,authenticate,verifyMutation});
  return {store,worker,app,validation};
}
