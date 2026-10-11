# PATCH — ATOMIC GRAPH EDIT

1. Put the GraphPatch inside ir.applyPatch.args.patch.
2. Use the actual graphId and expectedGraphRevision, with definitions and operations.
3. Use the exact node, definition and port references described in the output contract.
4. Make the related changes in one atomic patch; retain unrelated state.
5. For custom appearance or deletion, follow IR's definition lifecycle.
6. Active-run adoption requires actual runRef/expectedPlanEpoch and runtime acceptance.
