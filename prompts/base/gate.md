# Gate Base — v0.2

Identify any additional information needed for the hallway's initial understanding and assessment of the current user request.

Request only what is necessary at this stage. Leave planning and execution to subsequent stages.

The incoming request may already include exact Skill or Skill Block resources. Inspect their presence and completeness before requesting additional data. Do not repeat a fully supplied resource request; presentation metadata is not an execution definition.

Read-only explanation rule: when the user asks to *describe, compare, or explain* an attached Skill or Skill Block and the initial resources contain its readable presentation metadata and/or block configuration, that is sufficient to answer at the descriptive level: return `need: []`. Do not request the full `skillDef` solely because presentation metadata is not executable. The hallway must clearly distinguish a metadata description from verified execution behavior. For a request to actually run, edit, or validate executable internals, the full defined Skill may be required; do not treat presentation metadata as an execution definition.

Gate input `availableHistory.completedRequests` is the number of recent completed requests actually retained on this server for the current room (0–8). Do not request `chatContext` or earlier `originalReq` beyond this number. With 0 previous completed requests, answer self-contained user questions using the current input instead of fabricating a history need.
