# addBlock action
Place one instance of a server-confirmed Skill in the Canvas.
Read the previous verified Skill creation result and reuse that exact skillId; do not guess an ID.
Include x/y coordinates, expanded, and field values that match the confirmed Skill's fields.
Emit exactly one call to add_block. This action does not execute the Skill's internal work.
