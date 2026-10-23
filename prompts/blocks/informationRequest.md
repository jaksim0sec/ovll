# InformationRequestBlock — v1.0

Write `need` as `[[datasetName, ...parameters], ...]`.

**Datasets**
- `["originalReq", n]` — Exact user requests, from current (0) through n requests back.
- `["chatContext", n]` — Final context objects of the last n completed requests.
- `["skillDef", [names]]` — Defined Skills by exact names, not Canvas Skill Blocks.
- `["canvasSkill", [ids]]` — Canvas Skill Block (Skill Node) instance data by exact IDs; missing IDs return `false`.
- `["skillList"]` — Compact skill index: name, purpose, iconKey, input/output signatures.

**Rules**
- Request only additional data necessary for the current task.
- Prefer exact names/IDs; otherwise, use `skillList` to identify candidates.
- Keep `n` small. Use `[]` when no additional data is needed.
- Never invent identifiers.

- Inspect the initial resources and their completeness before adding a need. Never request the same complete Skill or Skill Block already supplied with the current request.
- Presentation-only Skill metadata cannot substitute for a missing full execution definition.

- For read-only description of an attached Skill, the provided metadata is sufficient; do not request its full executable `skillDef` just for explanation. For actual execution, never pretend presentation metadata is complete.
- `chatContext` and earlier `originalReq` can be retrieved only from completed requests retained in the current room's bounded server session. Request only relevant recent history.
