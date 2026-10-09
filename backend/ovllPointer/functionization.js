// Functionization detection is a proposal, never automatic persistence or verified status.
export function suggestFunctionization({ task, graphRef, evidence = [] } = {}) {
  if (!task || task.status !== 'completed' || !task.taskId || !task.objective) return null;
  if (!Array.isArray(task.requiredOutcomes) || !task.requiredOutcomes.length) return null;
  const delivered = new Set(evidence.filter(e => e?.verified && typeof e.ref === 'string').map(e => e.ref));
  const satisfied = task.requiredOutcomes.every(o => Array.isArray(o.evidenceRefs) && o.evidenceRefs.length > 0 && o.evidenceRefs.every(ref => delivered.has(ref)));
  if (!satisfied) return null;
  return {
    taskRef: task.taskId,
    purpose: task.objective,
    provenanceRefs: [...delivered],
    graphRef: graphRef || null,
    status: 'candidate',
    next: 'fn.extract',
    requiresReview: true,
    saved: false,
    verified: false
  };
}
