# Ovll — Native Workshop Function Calling and Verified Action Flow

> Superpowers design | 2026-10-24 | beta only
> This document proposes the **next vertical slice**, not a full implementation of all 12 advertised actions.
> User direction: proceed after the managed multi-request Engine + action-shell stage. Preserve that engine and the agreed action-granular plans.

## Intent and measured baseline

The user needs a real user request such as "식물 조사 스킬블럭 만들어줘" to **define a reusable Skill, place the corresponding Skill Block, and show it** without pretending a plan/handoff is execution.

As observed in beta:
- `createEngine()` owns Scheduler/Registry and `createRequestRunner` owns Gate/Hallway. `callManager` tracks Gate/Hallway Calls and gives Action Shell its own CallRecord, but **does not call Gemini for actions**.
- `gemini.js` uses the `generateContent` REST API with JSON output, no native Function Calling.
- `server.js` supplies an immutable empty asset catalog; `dataProvider` can read `assets.read({scope:roomId})`.
- Browser `Workspace Model` has a **separate local editable graph**. `workspace.applyServerAssets` already validates and conditionally applies a confirmed server graph when it is safe, preserving diverging local edits; `requestBridge` already refetches assets on verified completion.
- Only `skillDefine.defineDirect` and `canvasEdit.addBlock` should form the first real end-to-end slice. Other action names remain registered but honestly unsupported until implemented.

The previous non-IR Workshop implementation was deliberately retired. Do not bring back `workshop.js`, its JSON action router, or a fake success path.

## Alternatives and selected direction

| Approach | Benefit | Cost | Outcome |
|---|---|---|---|
| A. Model directly mutates frontend Canvas via Function Calling | Quick demo | Breaks engine independence; no authoritative revisions or reliable results | Reject |
| B. Give Gemini **one selected tool** for each Hallway action; execute through server-side validated, idempotent Action Port | Small provider boundary; exactly matches action-plan routing | Requires server asset state/checkpoints and explicit UI projection | **Selected** |
| C. Let Gemini run all tools in one autonomous chat session | Fewer orchestrator steps | Model, not Engine, decides routing; prompt bloat; hard to prevent accidental extra changes | Reject |

The **model proposes arguments**, the **Engine approves an action**, the **Action Port applies a side effect**, and the **Engine controls the next step**. Gemini must never be given the entire action catalog for a single action call.

## First functional slice and boundaries

1. Hallway may plan `skillDefine.defineDirect → canvasEdit.addBlock → terminate`.
2. For `defineDirect`, a dedicated prompt and **one** native tool declaration ask the model for a real reusable Skill definition.
3. Validate the proposed arguments against deterministic Skill/port/field/icon constraints. Only after validation, prepare an operation ID and expected revision, then call `assets.apply`.
4. Record the real `skillId`/revision from `applied` in `verifiedResults` and advance plan cursor.
5. For `addBlock`, assemble a different prompt and Function Calling declaration, with the **confirmed** preceding `skillId` and current Canvas state as input. Refuse invented/unavailable IDs. After server application, record `blockId`/revision and advance cursor.
6. Upon `terminate` and complete verified results, call the existing Output prompt (normal JSON generation) and finalize the existing room session. Its answer must distinguish **defined** from **executed**: saving a research Skill does not mean research ran.
7. Browser re-fetches `/api/rooms/:roomId/assets` and applies confirmed revisions through the existing guarded `applyServerAssets` projection. If local edits diverge, preserve them and show the existing conflict warning instead of silently replacing.
8. Other actions (`skillDefine.revise`, `skillEdit.*`, `canvasEdit.editBlock/deleteBlock/addLink/removeLink`, `textGenerate.*`, `defineFromIR`) are **not executed** in this slice. Return explicit unsupported state and preserve any preceding applied outcomes without declaring whole request completed. A later planned action must not run merely because the model returned its name.

**No IR execution, Skill research execution, permanent DB, user authentication, multi-process operation recovery or automatic import of local canvases.**

## Exact runtime contracts

### Action registry

Map qualified action names to descriptors:

```ts
type ActionDescriptor = {
  action: 'skillDefine.defineDirect' | 'canvasEdit.addBlock';
  promptLayer: 'workshop.skillDefine.defineDirect' | 'workshop.canvasEdit.addBlock';
  functionName: 'define_direct' | 'add_block';
  toolDeclaration: {
    name: string; description: string; parameters: object;
  };
  validateArgs: (args: unknown, snapshot: ActionSnapshot) => ValidatedArgs;
};
```

Only the two registered descriptors may execute. Every invocation is bound to the already-selected Hallway action. No string-to-implementation dynamic imports, eval, indirect UI mutation or fallback to similarly named tools.

### Model port

Keep `model.generate({prompt,context,format:'json',signal})` unchanged for Gate, Hallway and Output.

Extend the *model-neutral* provider port with:

```ts
generateFunction({
  prompt: string,
  context: object,
  tool: {name:string, description:string,parameters:object},
  signal?: AbortSignal
}): Promise<{
  kind: 'function_proposal',
  name: string,
  args: object
}>
```

`callManager.invokeFunction(...)` owns a new CallRecord, dynamic `focus`, the shared Gemini call limit and abort checks, and invokes that provider port. A valid proposal **completes the Call**, not the Action.

### Gemini-specific adapter

Use **existing `generateContent` REST** for the first slice, to avoid simultaneously migrating the Gate/Hallway provider. Send exactly one `functionDeclarations` entry and `toolConfig.functionCallingConfig={mode:'ANY',allowedFunctionNames:[tool.name]}`. Parse *exactly one* `functionCall` from the selected candidate; reject zero, multiple, foreign name, invalid arguments, or mixed independent function calls. Provider output is **untrusted**.

Because Engine applies the function result and supplies verified outcomes in a **new action/Output call**, this first slice does not need a second Gemini call to answer the same function-call turn. If the model conversation is later continued, then preserve the full function-call response and thought signature and submit the matching functionResponse; do not reconstruct signatures from JSON text.

Official docs: https://ai.google.dev/gemini-api/docs/generate-content/function-calling and https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures ; the Interactions API is a possible future provider adapter, not an engine contract.

### First two action argument formats

`define_direct`:
```json
{
  "name":"식물 조사하기",
  "description":"이름으로 식물의 정보를 조사하기 위한 스킬",
  "instruction":"사용자가 입력한 식물 이름을 조사하고 출처를 설명한다.",
  "icon":"globe",
  "color":"#4F8EF7",
  "inputs":[{"id":"in","label":"입력","type":"any","multiple":true}],
  "outputs":[{"id":"result","label":"결과","type":"research","multiple":true}],
  "fields":[{"id":"request","label":"조사할 식물","placeholder":"예: 은행나무","default":"","maxLength":1800}]
}
```

Validation: `name` 1..80, `description` 1..280, `instruction` 1..4000; `icon` must belong to the real front renderer icon catalog, `color` exactly #RRGGBB, port/field IDs unique nonempty ASCII, max 8 each, types from the current Canvas-supported type vocabulary, `multiple` boolean; field label 1..80, placeholder/default string and maxLength 1..1800. A Skill definition **does not run its instruction**. Server creates `skillId` and `revision`, never trusts an AI-created ID.

`add_block`:
```json
{"skillId":"skill-actual-server-id","x":120,"y":120,"expanded":true,"values":{"request":""}}
```

Validation: existing full Skill in the same room, stable finite x/y within a bounded Canvas range, expanded boolean, values keys from Skill.fields and string values within each maxLength. Server creates `blockId` and revisions. The new block references only an existing Skill; do not equate Skill and Skill Block.

### Asset port & operation boundary

```ts
assets.read({scope: roomId}): {
  revision:number, skills:Skill[], blocks:Block[], links:Link[]
};

assets.apply({
  scope:roomId,requestId:string,operationId:string,
  action:string,args:object,expectedRevision:number
}): {
  status:'applied'|'conflict'|'rejected',
  operationId:string,revision:number,
  artifacts?:object[],changeSet?:object,reason?:string
};

assets.getOperation({scope:roomId,operationId:string}):
   AppliedOutcome | null;
```

Server-issued operationId is written as `pendingOperation` on the *request checkpoint* **before** `apply`; `applied` result and cursor are checkpointed before planning the next action. The backing store enforces idempotency by `(scope,operationId)` and request revision/expected asset revision. Repeated same operation returns same outcome, reusing ID with different input rejects. If an outcome is unknown, inspect `getOperation` rather than generate a fresh operationId.

For beta only, a new **memory implementation** may own the authoritative assets and operation cache; state lifetime ends when the server restarts. It must remain a replaceable adapter, not be embedded in `requestRunner`. Record committed side effects even if Output fails.

### Request flow and status ownership

- `RequestRunner` owns sequential plan cursor and action selection; `CallManager` owns tool-call envelopes and limits; `assets` owns applied effects.
- `contextBlock.intent/progress` are request-scoped and updated via Hallway/Output blocks, **focus** regenerated per Call, **contextData** room-scoped and committed only after successful Output/direct answer.
- Store `verifiedResults` for every `applied` step, including partial failure. Only those may be mentioned as confirmed.
- `terminate` is a server plan marker, never a Gemini tool. Enforce call/action/return caps (initially 40/24/5 as historical safety limits).
- Output error must not retry already applied operations.
- If model returns another function name, malformed args or asset conflict, the Engine must decline the effect. The first slice can stop with an explicit **failed/unsupported** status and verified partial outcomes; later Hallway Return is an independently tested extension, not a silent alternate tool call.
- Re-check AbortSignal, Call record status and request checkpoint before committing. An action applied before cancel remains applied and visible; cancellation prevents new actions. Never incorrectly claim an applied side effect was rolled back.
- Current room/session concurrency uses revision CAS. Same-room writes to the same asset must be serialized at the action-store atomic boundary.

### Browser projection

Existing `requestBridge.loadAssets` and `workspace.applyServerAssets` are reused. The server emits Skill/Block objects matching `workspace/model.js` validation: `skillId`, `fields`, `inputs/outputs`, `values`, `x/y`, `expanded`; no synthetic `file` blobs. `source` and revision must remain truthful.

Do **not** silently treat provisional IDB graph as authoritative; if local changes conflict with confirmed server Canvas, preserve them and warn. An empty server read is not permission to erase a nonempty local graph. Frontend can show new server-owned Skill in the Library even if Canvas could not be replaced.

## Proof and tests

- Fake-provider test Gate → Hallway(defineDirect,addBlock,terminate) → two different Function Calling CallRecords → two applied outcomes → Output → completed; verify real Skill ID passes into second action and Browser-safe assets state contains actual Skill + Block.
- Provider REST test verifies `tools.functionDeclarations`, `toolConfig.functionCallingConfig.ANY` and only one declaration; rejects wrong name, empty/multiple calls, non-object args, 429/401/network failure, aborted call; no key leak.
- Invalid icon/port/field/Skill ID and revision conflict have **zero changes**.
- Operation idempotency and recorded partial success; cancel before/after apply; Output fails after side effect without rerunning mutation.
- Concurrent different rooms isolated; same-room conflicting writes do not overwrite.
- Unsupported actions still stop honestly, direct-answer path unchanged, no resurrection of old Workshop and no IR execution.
- Existing frontend local edits survive server projection conflicts.
- Run Node backend and browser-independent frontend suites; separate actual Gemini, Render and Playwright browser runs.

## Decisions and explicitly open follow-ups

**Chosen for this slice:** Existing REST generateContent provider with `ANY` one-tool calls; two real actions; ephemeral in-process authoritative asset store; exact per-action prompt; Engine manages cursor and Call ID; reuse browser's confirmed-assets projection with conflict protection.

**Not claimed implemented:** all 12 actions, Hallway Return loop, waiting/resume, permanent database, provider conversation continuation/Interactions API, actual Skill research execution, multi-process recovery and formal user authentication. These need later slices and their own tests and implementation approval.
