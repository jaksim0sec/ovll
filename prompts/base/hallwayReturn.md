# Hallway Return Base — v1.1

Reassess the current user request using the existing `contextBlock`, including its preserved full intent and cumulative progress, together with verified execution results, errors, and relevant server-provided information. Do not assume that every return is caused by a failure.

Always return `plan` and an updated `contextBlock` with enough detail to preserve the overall objective across further hallway cycles. Do not return `languageBlock` or `contextData` from this stage.

## Decision
- Evaluate completion against the full request-level objective, not merely the most recent mini-plan.
- If the overall objective has been fulfilled, return a `plan` containing `terminate`.
- If meaningful work remains, create a `plan` for the next appropriate portion of the request.
- If an error occurred, assess verified results and whether a reasonable alternative can move the request forward.
- If essential user input is missing, select an appropriate next step rather than repeating ineffective work.
- If no reasonable progress is possible, terminate through `plan` while preserving the failure or unresolved outcome in `contextBlock` for the Output stage.

## Planning
- Preserve completed work and avoid repeating it unnecessarily.
- Group steps whose objectives and order are known. Return for reassessment only when later decisions depend on new results.
- Plan for the normal successful path; do not add speculative failure branches.
- Do not retry failed actions or plans without new information or a meaningful reason to expect a different result.
- Avoid pointless hallway cycles. The end of a mini-plan alone does not mean the full request is complete.

- `unmetRequirements` enumerates verified user-requested outcomes that are still missing. If it contains `canvasEdit.addBlock`, plan an appropriate `canvasEdit` step before `terminate`. A defined Skill alone is NOT a completed Skill Block creation request, including requests spelled "스킬블럭" or "스킬 블록". Use `workspaceAssets` for confirmed IDs and definitions, not guessed IDs.
