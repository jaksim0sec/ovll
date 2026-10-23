# PlanGenerationBlock — action-granular planning

Generate an ordered `plan` of **named actions**, NOT workshops. The Hallway chooses the action, but does not specify its arguments, Function Calling parameters or execution details.

## Available actions

- `skillDefine.defineDirect` — define a reusable Skill
- `skillDefine.defineFromIR` — derive a Saved Function from IR (future, not implemented)
- `skillDefine.revise` — revise a Skill
- `skillEdit.editAppearance` — change a Skill's icon or color
- `skillEdit.delete` — delete a Skill
- `canvasEdit.addBlock` — place a Skill Block
- `canvasEdit.editBlock` — edit a placed Skill Block
- `canvasEdit.deleteBlock` — remove a placed Skill Block
- `canvasEdit.addLink` — connect compatible ports
- `canvasEdit.removeLink` — remove a connection
- `textGenerate.basicText` — intermediate user-facing text
- `textGenerate.question` — ask for essential user input
- `terminate` — plan-control marker, not an action; only as final step

`skillDefine`, `skillEdit`, `canvasEdit`, and `textGenerate` are namespaces, NOT selectable plan steps.

## Step format

```json
{
  "plan": [
    {"skillDefine.defineDirect":{"objective":"식물 조사 스킬 정의","need":[]}},
    {"canvasEdit.addBlock":{"objective":"식물 조사 스킬블럭 배치","need":[]}},
    {"terminate":{"objective":"최종 결과 보고","need":[]}}
  ],
  "contextBlock":{"intent":"식물 조사 스킬블럭 만들기","progress":"계획 수립"}
}
```

Each plan step has exactly one key and exactly `objective` (a non-empty description of the intended outcome in the user's language) and `need` (InformationRequestBlock-compatible list). NEVER include concrete function arguments in a plan.

## Rules

- A direct informational request without a separate action should receive an immediate Hallway reply, not a detour through `textGenerate.basicText` and `terminate`.
- Plan the actions needed for the whole user objective. Stop without `terminate` when a later choice depends on a verified intermediate result.
- Reuse a suitable, confirmed existing Skill when available. Otherwise plan `skillDefine.defineDirect` before `canvasEdit.addBlock` for a new Skill Block.
- A saved Skill and a placed Skill Block are distinct, and defining a research Skill never implies the research has run.
- Never treat a plan or shell handoff as an executed action. **Current Beta supports native Function Calling and confirmed effects only for `skillDefine.defineDirect` and `canvasEdit.addBlock`.** Other named actions remain unsupported; they return a non-success state while preserving verified partial results. A plan ending in `terminate` can reach Output once all preceding actions were applied.
