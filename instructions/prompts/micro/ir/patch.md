# PATCH — ATOMIC GRAPH EDIT

1. Describe the requested definitions, instances and links as semantic actions.
2. Use declared created aliases and actual existing node/definition selectors; the host supplies graph identity, revision and dependencies.
3. Place related graph edits together before execution, saving or questions; they form one atomic patch and preserve unrelated state.
4. Deleting a linked node needs removeIncidentLinks:true or explicit link.remove for every incident link; never assume implicit unlink or rewire.
5. For custom appearance, behavior revisions and deletion, follow IR's definition lifecycle.
6. Active-run adoption is unavailable in this local host. Obtain fresh state before changes following an execution.
