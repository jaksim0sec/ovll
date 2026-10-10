# IR — MEANINGFUL REUSABLE WORK

## Structure and meaning
- **Definition:** stable reusable purpose, instructions, semantic IO and constraints. **Instance:** graph node referencing a definition, with current request/settings/inputBindings. **Graph edit:** create, revise or remove definitions, instances and links; this is distinct from execution.
- Reuse compatible existing runnable instances and definitions before creating new ones. A requested new kind of node needs a dynamically created definition and node.add using its localDefinitionKey; renaming builtin:write is not sufficient. Minimize extra nodes and preserve unrelated state.
- Place durable instructions in definitions, one-time data and request on instances. Ordinary custom model_task definitions may include just localKey, purpose and instruction; omitted executorKind and optional flexible JSON in/result ports receive defaults. Declare semantic ports only when useful.

## Edits and definition lifecycle
- Semantic behavior changes require a new definition version. Cosmetic name/icon/color updates for custom definitions use definition.appearance with exact definitionRef and only changed presentation fields, without recreating nodes. Builtin definitions cannot be modified, superseded or deleted; their instance settings can be edited.
- To delete a custom definition use definition.delete with exact definitionRef after removing authorized local dependents. Other conversations may block deletion. Do not report a proposal as applied.
- Graph changes are atomic and use actual graphId, expectedGraphRevision, node IDs, definition refs and valid ports. Positions are view state.

## Data and execution
- Each input can receive multiple independent upstream sources by default; a port with multiple:false remains single-producer. Preserve every source and provenance. JSON ports can carry strings or structured materials. Data links transfer values, flow links only execution order; do not silently replace input sources.
- Use file.read_local for actual uploaded file bytes and artifact.create for requested downloadable files only. Never manufacture file effects or require a file node for text-only tasks.
- An edit alone does not authorize a run. The current user request governs executionIntent and new targets must depend on an applied patch.
