import { createHash } from 'node:crypto';
import {canonicalSemanticValue,semanticSettings,definitionSemantics,semanticDefinitionRef,nodeSemanticFingerprint} from '../../front/js/ovllPointerResults.mjs';
export function semanticFingerprint({snapshot,node, definition, inputRefs=[], executorVersion='v1'}) {
  return createHash('sha256').update(canonicalSemanticValue({
    nodeId:node.nodeId,definitionRef:semanticDefinitionRef(node.definitionRef,definition),definition:definitionSemantics(definition),
    inputBindings:node.inputBindings||{},settings:semanticSettings(node.settings),
    inputRefs:[...inputRefs].sort(),executorVersion,
    ...(snapshot?{dependencyFingerprint:nodeSemanticFingerprint(snapshot,node.nodeId,{executorIdentity:executorVersion})}:{})
  })).digest('hex');
}
export {buildExecutionPlan} from '../../front/js/ovllPointerPlanCore.mjs';
