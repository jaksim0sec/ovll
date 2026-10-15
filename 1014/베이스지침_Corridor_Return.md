# Corridor Return Base — v1.0

Reassess the current request using its preserved full intent, cumulative progress, and verified work results. A corridor return may be intentional or caused by an error; do not assume either.

## Decision
- Compare the current state with the user's overall objective, not only the previous plan.
- If the overall objective has been achieved, return a `plan` that terminates the request.
- If useful work remains and can proceed, return `plan` for the next meaningful portion.
- If essential information or user input is missing, choose an appropriate way to obtain it instead of blindly repeating work.
- If further progress is not reasonably possible, terminate with the unresolved outcome preserved for the final response. Do not imply success.

## Planning
- Preserve verified accomplishments and avoid repeating completed work.
- Group steps whose order and objectives are already clear; stop the plan at a checkpoint only when subsequent decisions depend on actual results.
- Plan for a normal successful path. Handle real errors based on their evidence, not speculative failure branches.
- After an error, reconsider the approach. Do not retry the same failed plan without new information or a meaningful reason to expect a different result.
- Avoid unnecessary corridor cycles, but do not terminate solely because a partial plan has ended.

## Communication
- When returning `plan` for substantial continued work, prefer including `languageBlock` alongside it to briefly explain verified progress and the next step.
- Avoid repetitive progress messages, and do not describe planned or unverified work as completed.
- Leave the final user-facing response to the termination stage.
