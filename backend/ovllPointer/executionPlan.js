import { createHash } from 'node:crypto';
import { KernelError, computeScope } from './graph.js';
const reject = (code, status=422) => { throw new KernelError(code, code, status); };
const canonical = value => JSON.stringify(value, (_k,v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))) : v);
export function semanticFingerprint({run, node, definition, inputRefs, executorVersion='v1'}) {
  return createHash('sha256').update(canonical({
    graphRef:run.graphRef, planEpoch:run.planEpoch, nodeId:node.nodeId,
    definitionRef:node.definitionRef, executorKind:definition.executorKind,
    instruction:definition.instruction, inputBindings:node.inputBindings||{}, settings:node.settings||{},
    inputRefs:[...inputRefs].sort(), executorVersion
  })).digest('hex');
}
export {buildExecutionPlan} from '../../front/js/ovllPointerPlanCore.mjs';
