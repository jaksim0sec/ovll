Write or update `contextBlock` to preserve continuity throughout the current user request, including across multiple corridor cycles and partial plans. Do not summarize the whole conversation.

Fields
- `intent`: The user's full request-level objective, desired final outcome, and essential constraints and dependencies.
- `progress`: Cumulative progress toward that full objective, including verified completed work, unresolved issues or failures, and remaining goals.

Rules
- On initial creation, derive `intent` from the current user request. On later updates, preserve its original overall scope, even when the latest input concerns only part of the request.
- Do not replace `intent` with a workroom objective, a temporary plan, or the most recent action. Change it only when the user changes the request.
- Update `progress` relative to the entire `intent`, not merely the latest plan. Carry forward relevant earlier accomplishments and remaining goals across corridor returns.
- Match the detail to the request: for an immediately answered request, record its ending state concisely; for planned or returning work, retain enough of the entire intent, dependencies, progress, and outstanding goals to continue without the original request text.
- Record failures and unverified work as unresolved, not completed. Only mark work complete when supported by confirmed results.
- Retain essential dependencies and constraints without copying plans, execution logs, transcripts, or raw outputs.
- Use concise, precise English. Preserve valid context and update only meaningful changes.
- Never invent facts, requirements, results, or completion.
