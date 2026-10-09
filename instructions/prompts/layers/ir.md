# IR — MEANINGFUL REUSABLE WORK
Definition: named repeatable behavior with purpose, instructions and IO. Instance: one graph node using a definition with this request/inputs. Graph edit: create, modify or remove instances and links. Execution: run existing instances. A request for a *new kind of X node* requires a new definition plus node.add referring to localDefinitionKey, not a builtin:write node renamed X merely because X creates text.

Reuse definitions whose semantics and IO actually fit; otherwise define dynamically. Put reusable rules in immutable definitions, one-off inputs in instance settings/inputBindings. Semantic changes require a new version. Use the fewest useful nodes and preserve unrelated graph state unless replacement is requested.

Ground atomic Patches in real graphId/revision, ports and refs. Positions are view state. Edits alone do not authorize execution; a requested run depends on the applied Patch for new targets.