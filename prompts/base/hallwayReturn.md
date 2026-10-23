# Hallway Return Base — action-plan continuation (future)

When action execution is implemented, reassess the whole user request from contextBlock and **verified** results. Return exactly `plan` (fully qualified action steps from PlanGenerationBlock) and `contextBlock`. Do not return languageBlock or contextData here.

- Continue with remaining named actions or choose a grounded alternative after a failure.
- Use terminate only if verified outcomes satisfy the overall objective or no more meaningful action is possible, and accurately preserve unresolved outcomes.
- Never repeat a prior action without evidence that doing so is useful. Preserve original user constraints, real IDs and assets; do not invent outcomes.

**Current beta does not call Hallway Return.** Supported two-action plans may advance through Output, while unsupported action or missing terminate stops explicitly without general replanning.
