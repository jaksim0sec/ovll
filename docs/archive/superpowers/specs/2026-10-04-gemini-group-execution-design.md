# Gemini grouped execution design

Date: 2026-10-04

## Goal

Replace demo-only node execution with a production-oriented Gemini execution path while preserving the current RuntimeEngine node/edge state model.

Optimize for the Gemini API free tier first:
- reduce request count by batching safe linear node sequences
- never expose the Gemini API key to the browser
- use a free-tier model by default
- tolerate project-specific quota/rate-limit changes without hard-coded RPM/RPD values
- retain per-node outputs, status, reports, failure propagation, and branch semantics

This design does not change the Groq workflow planner. Gemini is only the workflow execution model.

## Current constraints

The current browser RuntimeEngine already owns:
- target/spread execution scope
- dependency ordering
- cycle rejection
- judge branch activation
- node/edge state events
- FAILED/SKIPPED dependency propagation

That engine must remain authoritative for execution semantics. Gemini must not be allowed to redefine graph topology, skip arbitrary nodes, or invent extra nodes.

The root executor.js is currently demo-only and is not wired into the active front/js/runtimeEngine.js path.

## Gemini API choice

Use the Gemini Interactions API through direct server-side REST.

Endpoint:
- POST https://generativelanguage.googleapis.com/v1beta/interactions

Authentication:
- x-goog-api-key from server-only GEMINI_API_KEY

Default model:
- gemini-3.5-flash-lite

Fallback model:
- gemini-3.1-flash-lite

Environment overrides:
- GEMINI_MODEL
- GEMINI_FALLBACK_MODEL
- GEMINI_API_KEY

Rationale:
- Gemini 3.5 Flash-Lite is a current cost-efficient model intended for high-volume agentic/simple processing and has a free tier.
- Gemini 3.1 Flash-Lite also has a free tier and is an acceptable lower-cost fallback.
- Gemini 2.5 models are not the default for a new project because current Google guidance recommends newer model families.
- Gemini 3.8 Flash is intentionally not the default fallback because the application is explicitly optimizing for free-tier execution and does not need to silently jump to a more expensive production model if billing is later enabled.

Use store:false. Workflow node groups are stateless jobs; server-side conversation retention is unnecessary.

Use generation_config.thinking_level:"minimal" by default for Flash-Lite. Allow GEMINI_THINKING_LEVEL override among minimal/low/medium/high only when supported by the configured model.

Do not send deprecated sampling controls such as temperature/top_p/top_k for Gemini 3.x.

## Free-tier and quota strategy

Do not hard-code RPM, TPM, or RPD values. Gemini rate limits are project/model/account dependent and the currently active limits are exposed through Google AI Studio.

The execution layer will instead:
1. minimize calls through safe node grouping
2. cap each group size
3. cap serialized prompt bytes
4. retry transient failures
5. honor Retry-After when present
6. use exponential backoff with jitter otherwise
7. attempt fallback only for model availability/unsupported-model failures, not for ordinary semantic failures
8. return a typed runtime error after retries so current FAILED/SKIPPED propagation handles the graph

Retry policy:
- max 3 attempts per selected model
- retry HTTP 429 and 5xx
- retry network errors
- do not retry ordinary 4xx validation/auth errors
- Retry-After wins when provided
- otherwise delay approximately 750ms, 1500ms, 3000ms plus small jitter
- fallback model may be attempted after primary model exhaustion only when fallback is configured and distinct

Because this is a user-triggered interactive flow, do not use Batch API or background execution.

## Execution grouping

RuntimeEngine plans groups. Executor executes groups.

A node is Gemini-capable when its type is:
- research
- organize
- judge
- write
- convert

Local boundary node types:
- start
- file
- createFile

A group can contain one or more Gemini-capable nodes.

A node may be appended to an existing group only when all of the following are true:
- previous node and candidate node are Gemini-capable
- previous node has exactly one outgoing dependency edge in the selected execution scope
- candidate node has exactly one incoming dependency edge in the selected execution scope
- that single edge connects previous -> candidate
- previous node is not judge
- candidate node is not judge
- neither endpoint is a local boundary node
- group has fewer than GEMINI_MAX_GROUP_NODES nodes, default 6
- estimated serialized group request remains below GEMINI_MAX_GROUP_INPUT_CHARS, default 60000

The group is cut at:
- fork: outgoing dependency count > 1
- merge: incoming dependency count > 1
- judge
- local boundary node
- group size/input cap

judge is executed as a single-node Gemini group because its decision controls topology and therefore must be committed before downstream groups are planned/executed.

Grouping must consider both flow and data dependency edges. A linear chain connected only through data dependencies is still a dependency chain and may be grouped if the 1-in/1-out conditions are satisfied.

## Runtime execution contract

Extend executors with an optional method:

runGroup(group, context)

group:
{
  nodes: [
    {
      id,
      type,
      params,
      inputs
    }
  ],
  internalConnections: [...],
  externalInputs: {...}
}

context includes:
- runId
- pivot
- mode

RuntimeEngine behavior:
- if executor.runGroup exists and a safe Gemini group has length > 1, run the group once
- single Gemini nodes may also use runGroup so judge and isolated LLM nodes use the same server path
- local nodes continue through executor.run/local handling
- before a group request, each included node transitions to RUNNING in dependency order
- after response validation, each node result is committed in order as SUCCESS
- node:state events are still emitted per node
- edge state remains driven by RuntimeEngine, not Gemini
- Gemini never receives permission to alter graph topology

If a group request fails as a transport/model failure:
- first node in the group is FAILED with the actual error
- later nodes in that group are SKIPPED with skipReason "dependency_failed" and blockedBy containing the first failed node
- independent branches continue
- final run status becomes FAILED

If the server returns a valid group response containing a per-node execution failure:
- commit successful results before the first failed result
- mark that node FAILED
- mark later same-group nodes SKIPPED dependency_failed
- never fabricate later outputs

## Gemini server endpoint

Add:
POST /api/execute-group

Request:
{
  nodes: [
    {
      id: string,
      type: string,
      params: object,
      inputs: object
    }
  ]
}

Server validation:
- 1..GEMINI_MAX_GROUP_NODES nodes
- unique non-empty ids
- only allow supported Gemini-capable node types
- params and inputs must be JSON objects
- reject excessive request size before calling Gemini
- never accept model name or API key from browser input

Response:
{
  ok: true,
  model: string,
  usage: {
    inputTokens: number|null,
    outputTokens: number|null,
    totalTokens: number|null
  },
  results: [
    {
      nodeId: string,
      outputs: object,
      decision: boolean|null,
      report: string
    }
  ]
}

Errors return:
{
  ok: false,
  code: string,
  error: string,
  retryable: boolean
}

Do not expose raw Gemini response bodies or API keys to the browser.

## Structured output schema

Use Interactions API response_format with application/json.

Schema:
{
  type: "object",
  properties: {
    results: {
      type: "array",
      minItems: N,
      maxItems: N,
      items: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          outputs: {
            type: "object",
            additionalProperties: true
          },
          decision: {
            type: ["boolean", "null"]
          },
          report: {
            type: "string"
          }
        },
        required: [
          "nodeId",
          "outputs",
          "decision",
          "report"
        ],
        additionalProperties: false
      }
    }
  },
  required: ["results"],
  additionalProperties: false
}

Server semantic validation after JSON parsing:
- result count exactly equals input node count
- nodeIds exactly match the requested ordered node list
- no duplicate/missing/extra node ids
- judge requires boolean decision
- non-judge decision must be null
- outputs must be plain JSON objects
- response size must remain bounded

If semantic validation fails, perform one repair attempt on the same model with a compact validation-error instruction. This repair counts inside the normal retry budget and does not include raw secrets.

## Output semantics

Gemini nodes use these output contracts.

research:
- outputs.result may be structured JSON containing findings/sources/summary useful to later nodes

organize:
- outputs.result contains transformed/organized input

write:
- outputs.result contains the produced document/text and relevant metadata

convert:
- outputs.result contains converted/transformed content

judge:
- decision is required boolean
- outputs.true contains the useful pass-through/result when true
- outputs.false contains the useful pass-through/result when false
- inactive branch output should be omitted or null-equivalent as normalized by the server

Do not force every node result into plain text. Preserve JSON values because downstream nodes need structured context.

## Prompt design

System instruction:

"You execute a fixed workflow segment for ovll.
The graph and node order are already decided by the runtime.
Execute every supplied node exactly once and in the supplied order.
Do not add, remove, reorder, rename, or skip nodes.
Each node consumes its declared inputs plus outputs produced by earlier nodes in this same group when connected.
Follow each node's type and params precisely.
Return only the schema-conforming result.
Keep outputs useful for the next node instead of explaining your process.
Do not include chain-of-thought, hidden reasoning, markdown fences, or commentary.
For judge nodes, make a boolean decision from the condition and available input. Do not decide graph traversal yourself.
If information is missing, use only reasonable transformations supported by the supplied inputs and params. Do not invent external facts or claim external research that was not actually available."

User input is compact JSON:
{
  "nodes": [
    {
      "id": "...",
      "type": "...",
      "params": {...},
      "inputs": {...}
    }
  ],
  "connections": [
    {
      "fromNode": "...",
      "fromPort": "...",
      "toNode": "...",
      "toPort": "...",
      "kind": "flow|data"
    }
  ]
}

Per-node instruction appended server-side, not supplied by browser:

research:
"Analyze the supplied material according to params.topic/filter. If no web/search tool is provided, research means reason over supplied material and general model knowledge; never fabricate citations or pretend live browsing occurred."

organize:
"Transform the available input according to params.criteria and params.format. Preserve important facts and avoid introducing unsupported claims."

write:
"Produce the requested content using params.title/style/length/about and available upstream material. The output should be directly usable, not a discussion of how to write it."

convert:
"Convert the available material according to params.instruction while preserving meaning unless the instruction explicitly requests transformation."

judge:
"Evaluate params.condition against the available input. Set decision to a boolean. Put usable branch data on the matching true/false output."

## Research node limitation

Free-tier Gemini 3.x currently does not provide Google Search grounding as a free API capability in the same way older 2.5 free-tier search allowance did. Therefore this implementation must not silently enable paid search grounding.

Initial implementation:
- no Gemini built-in web search tool
- research node uses model knowledge + upstream user-provided data
- report should not claim live web research

A future explicit "live research" feature can add a separately controlled tool/billing policy.

## Privacy/data handling

Free-tier Gemini requests may be used to improve Google products according to the current pricing/data-use table. This is a product/privacy consideration, not only a cost consideration.

Implementation:
- send only the selected execution group, not the entire canvas/chat history
- do not send conversation memory unless a node explicitly receives it as input
- use store:false
- avoid logging full user prompts/results in production server logs
- log model, status, latency, retry count, and usage totals only

## Files

front/js/runtimeEngine.js
- add safe execution-group planning
- integrate group jobs with existing node states
- keep current graph/error semantics

front/js/api.js
- add executeGroup() client call to /api/execute-group

front/js/app.js
- instantiate RuntimeEngine with a real executor adapter using AstraAPI.executeGroup
- preserve local execution for start/file/createFile
- remove demo delay path from active execution

server.js
- Gemini constants/config
- request validation
- Interactions API REST client
- retry/fallback
- structured-output schema
- prompt builder
- semantic response validator
- /api/execute-group
- bump APP_VERSION

test/runtimeEngine.test.js
- grouping boundaries
- one API call for a linear group
- fork/merge/judge boundary behavior
- group failure propagation
- per-node state/result commit order
- existing target/spread/failure tests remain green

Optional new test:
test/geminiExecution.test.js
- pure server helper tests if Gemini helpers are extracted into a focused module

## Testing strategy

No live Gemini API call is required in the automated suite.

Runtime tests use a fake executor implementing runGroup and assert:
- research -> organize -> write is one group call
- fork creates separate groups
- merge starts a new group
- judge is isolated
- local boundary cuts groups
- each node receives a distinct SUCCESS result
- group failure causes FAILED + dependency SKIPPED while independent branch survives

Server tests stub fetch and assert:
- x-goog-api-key is sent server-side
- model defaults to gemini-3.5-flash-lite
- store:false
- structured response_format is present
- thinking_level minimal
- 429 retries
- Retry-After honored through injectable sleep helper
- invalid schema response rejected/repaired
- fallback selection works without accepting client-provided models

## Rollout

1. Land grouping tests.
2. Add group planner to RuntimeEngine.
3. Add API client adapter.
4. Add Gemini server execution endpoint.
5. Wire app RuntimeEngine to the real executor.
6. Run complete test suite.
7. Bump server APP_VERSION.
8. Manual smoke test only when GEMINI_API_KEY is available.

No Groq planner behavior is modified by this work.
