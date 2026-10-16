# Ovll 1014 — Request runtime (integration draft)

This code follows the `1014/` design; it is **not wired to main**. Node 20+ ESM.

## Wiring (no extra manager framework)

1. `createPromptBuilder({manifest,readText})`: read ordered real prompt files from `instructions/newPrompts/`.
2. `createCallAI({provider,model,apiKey})`: single AI transport, provider-specific JSON/tools request bodies.
3. `createRequestRuntime({buildPrompt,callAI,lookupNeed,runWorkroom,loadRoom,saveRoomContext,persist,publish})`.
4. `runtime.begin({roomId,userRequest})` returns `{requestId, finished}`. Attach `finished` as your background execution promise. `runtime.stop(roomId,requestId)` aborts active model IO and returns a public snapshot; status/stop routes **must authenticate and authorize ownership**.
5. `publish` sends structured SSE. `persist` durably records validated progress/final snapshots **before** SSE. Separate room/asset revisions must be checked by their respective stores.

## Design constraints reflected

- Request initial state has the seven agreed fields. Plan & verified results appear as needed.
- `currentLayer` is server-owned; `planIndex` moves only after a verified workroom outcome. `terminate` -> Output, an unfinished mini-plan -> Corridor Return.
- Gate returns only `need`; Initial Corridor can directly answer with context & contextData without Output. Return Corridor only plans & contextBlock.
- Workroom receives **objective + need data** and `callModel` (same `callAI` inside); workroom adapter chooses actions. It must verify the actual action result, commit side effects durably before returning, and report `ok/summary/refs/replan`. The core doesn't invent unagreed Function Calling tools or IR contracts.
- Abort does not roll back committed actions. If an uninterruptible workroom action completes during cancellation and returns its real outcome, the runtime records it before marking the request stopped.
- `focus` is created for every call from current location and verified results, never edited by a workroom or stored in the request's contextBlock.
- Session `contextData` is taken from `loadRoom`, not trusted from a client's snapshot. `saveRoomContext` receives `expectedRevision`; it must do an atomic compare-and-swap, returning `{revision}` or null on conflict. On conflict fail clearly rather than overwrite another request.
- Call input/raw output is transient and never leaked in public snapshots. Completed request snapshots stay retrievable in the in-memory runtime; production must persist final records and bound in-memory retention.

## Explicitly not solved by the 1014 source docs

- Specific workroom tool declarations/arguments, IR effect verification, outcome transaction boundaries, multi-turn function-call result handoff, user-question pause/resume, `execute` plan representation.
- Authentication/authorization and actual HTTP routing, DB schema, restart recovery, reconnect replay, session-conflict merge policy, streaming model tokens, model rate-limit/backoff.
- Code uses in-memory maps and injected persistence; is not production-safe until these are wired. JSON mode and single-turn tool proposals are supported by `callAI`; multi-turn tool execution remains workroom responsibility.

## Test

`node backend/requestFlow/test.mjs` (deterministic mock transport; no API key).