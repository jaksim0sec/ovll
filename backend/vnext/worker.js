// Execution boundary: the worker never decides or invents graph semantics.
// A trusted executor must resolve pinned GraphRevision and record its node attempts.
import { KernelError } from './graph.js';
const fail=(code,status=422)=>{throw new KernelError(code,code,status);};
export function createRunWorker({store,executeRun,workerRef,leaseSeconds=30}={}) {
  if (!store || typeof store.claimRun!=='function' || typeof store.renewLease!=='function' ||
      typeof store.settleRun!=='function' || typeof executeRun!=='function' || !workerRef) fail('WORKER_DEPENDENCIES_REQUIRED',500);
  if(!Number.isInteger(leaseSeconds)||leaseSeconds<5||leaseSeconds>300) fail('INVALID_LEASE');
  return {
    async workOnce({workspaceRef=null}={}) {
      const job=await store.claimRun({workerRef,workspaceRef,leaseSeconds});
      if (!job || job.outcomeUnknown) return job;
      const signalController=new AbortController();
      let closed=false,renewing=false,leaseLost=false;
      const timer=setInterval(async()=>{
        if(closed||renewing)return;
        renewing=true;
        try{await store.renewLease({workspaceRef:job.workspaceRef,runRef:job.runRef,leaseToken:job.leaseToken,leaseSeconds});}
        catch{leaseLost=true;signalController.abort();}
        finally{renewing=false;}
      },Math.max(1000,Math.floor(leaseSeconds*1000/3)));
      timer.unref?.();
      try{
        // It may perform expensive work, but no action is acknowledged as completed without a server evidence gate.
        let outcome;
        try{outcome=await executeRun(job,{signal:signalController.signal});}
        catch(error){
          if(leaseLost)throw fail('STALE_LEASE',409);
          // Unknown external effects must never be automatically retried.
          outcome={status:job.externalEffect?'waiting':'failed',errorCode:error?.code||'EXECUTION_FAILED'};
        }
        if(leaseLost)fail('STALE_LEASE',409);
        if (!['completed','failed','waiting'].includes(outcome?.status)) fail('INVALID_EXECUTOR_OUTCOME');
        return await store.settleRun({workspaceRef:job.workspaceRef,runRef:job.runRef,leaseToken:job.leaseToken,
          status:outcome.status,evidenceRefs:outcome.evidenceRefs||[]});
      } finally {closed=true;clearInterval(timer);}
    }
  };
}
