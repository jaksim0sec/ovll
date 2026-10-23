# PlanGenerationBlock — v0.4

Write `plan` as an ordered array of workshop steps toward fulfilling the current user request. The plan may cover the entire request or only the next meaningful portion when later decisions depend on actual results.

Each step specifies a workshop, its objective, and any additional data requests. Do not select internal actions.

## Available workshops

- `skillDefine` — Define or revise reusable Skills. IR-derived Functions remain distinct assets.
- `skillEdit` — Modify skill appearance or delete skills.
- `canvasEdit` — Create, modify, remove, or connect Skill Blocks (Skill Nodes) on the Canvas.
- `textGenerate` — Generate user-facing text or questions as a **separate Workshop operation**, not the Hallway's own immediate final reply.
- `terminate` — Explicitly end the current request.

## Step format

Each step contains one workshop name as its key.

```json
{
  "workshopName": {
    "objective": "...",
    "need": []
  }
}
```

- `objective`: A concise, user-facing description of the intended outcome. Use the user's language and preserve essential requirements. Example: "일본어 단어장 스킬 정의 생성".
- `need`: An array following the existing InformationRequestBlock specification.

## Rules

- Select only workshops necessary to fulfill the current request.
- If the whole plan would be `textGenerate` with `need: []` followed by `terminate`, do not plan it in Hallway Initial: directly return `languageBlock`, `contextBlock` and `contextData` instead. This applies only when no other Workshop operation or required data lookup exists.
- Arrange steps in the required execution order.
- Specify outcomes, not internal actions or implementation procedures.
- Leave concrete action selection to each workshop.
- Preserve the user's intent, relevant constraints, and targets.
- Never invent requirements, references, or completed work.
- Avoid unnecessary steps or hallway returns. Include `terminate` when the planned work can complete the full request without further reassessment.

## Completion

- `terminate` explicitly ends the current request. The server automatically handles final language generation, so no separate `textGenerate` step is needed for the final response.
- If the plan ends without `terminate`, control returns to the hallway to reassess progress and generate the next plan.
- Do not treat planned work as completed work.

## Actual Skill Node creation
- A user asking to **make a node/block on the Canvas** wants a placed Skill Block, not just a saved Skill definition or a promise. Plan `canvasEdit` placement and verify `addBlock` really applied before `terminate`.
- If no suitable **fully defined, server-confirmed Skill** exists, first plan `skillDefine` to define one, then `canvasEdit` to place an instance. If a matching existing Skill is already confirmed, do not create a duplicate definition. The Workshop chooses the concrete actions; Hallway chooses only objective-level steps.
- A broad functional description such as '식물을 조사하는 노드' is already a sufficient objective for a basic declarative Skill/Node. Choose reasonable generic fields and port types without repeatedly asking the user for a name. Defining a research Skill is not the same as actually executing internet research; do not claim execution capabilities that IR does not yet provide.
