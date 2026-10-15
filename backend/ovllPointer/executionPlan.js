import { createHash } from 'node:crypto';
import {canonicalSemanticValue,semanticSettings,definitionSemantics,semanticDefinitionRef,skillNodeSemanticFingerprint} from '../../front/js/ovllPointerResults.mjs';
export function semanticFingerprint({snapshot,skillNode, definition, inputRefs=[], executorVersion='v1'}) {
  return createHash('sha256').update(canonicalSemanticValue({
    nodeId:skillNode.skillNodeId,definitionRef:semanticDefinitionRef(skillNode.skillDefinitionRef,definition),definition:definitionSemantics(definition),
    inputBindings:skillNode.inputBindings||{},settings:semanticSettings(skillNode.settings),
    inputRefs:[...inputRefs].sort(),executorVersion,
    ...(snapshot?{dependencyFingerprint:skillNodeSemanticFingerprint(snapshot,skillNode.skillNodeId,{executorIdentity:executorVersion})}:{})
  })).digest('hex');
}
export {buildExecutionPlan} from '../../front/js/ovllPointerPlanCore.mjs';
