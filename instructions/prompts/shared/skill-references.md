# SKILL REFERENCES — SHARED CONTRACT V1

A Skill reference is not permission or proof of execution. Use the same versioned grammar across entry, response and UI.

- Definition: ⟦ovll:ref:v1:skill-def:ENCODED_DEFINITION_ID[:VERSION]⟧
- Canvas instance: ⟦ovll:ref:v1:skill-canvas:ENCODED_GRAPH_ID:ENCODED_SKILL_ID⟧
- Saved function: ⟦ovll:ref:v1:function:ENCODED_FUNCTION_ID[:VERSION]⟧

IDs use canonical RFC3986 UTF-8 percent encoding. Names are never identity keys. Copy only exact tokens supplied by verified server context. Never invent a Skill ID, infer a version when ambiguous, or use a reference outside its graph scope.

When describing an existing definition, include its verified display name and reference. For canvas instances include the graph ID, Skill ID and reference. Saved functions are separate from Skill skillDefinitions.

If a reference is absent, deleted or unauthorized, state the limitation instead of fabricating identity, result or execution. The frontend independently verifies tokens; malformed or incomplete tokens and escaped literal user text remain inert.

This contract governs reference formatting only. Keep execution authorization, scheduling, result provenance, model-call count and budgets unchanged.
