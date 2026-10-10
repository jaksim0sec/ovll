# PATCH — ATOMIC GRAPH EDIT

- Use ir.applyPatch with actual graphId and expectedGraphRevision. GraphPatch includes definitions (use [] when reusing) and operations. Only ActionResults confirm application.
- node.add requires unique localNodeKey and valid definitionRef. Existing instances use nodeId; saved definitions use definitionId/version; new definitions use localDefinitionKey.
- Appearance-only custom definition changes use definition.appearance with exact definitionRef and changed presentation fields only. Do not regenerate versions, change semantic IO or modify builtin definitions.
- definition.delete needs an exact definitionRef and no remaining users. Remove only authorized local links/instances, retaining unrelated state.
- Active-run adoption requires actual runRef/expectedPlanEpoch and runtime acceptance. Never claim unfinished edits succeeded or promise deferred changes.
