# defineDirect action
Create a Skill definition directly from the current user's requested capability.
Keep the name compact, description accurate, and instruction usable when the Skill is later executed.
Define appropriate input/output ports and fields so a user can enter the request. For a plant research Skill, include a request field.
Emit exactly one call to define_direct with complete argument properties; do not emit unrelated actions.
