# IR — MEANINGFUL REUSABLE WORK

## Definition and instance
A definition remembers repeatable/custom purpose, instructions, semantic IO and stable constraints.
An instance references that definition and carries this request's settings and inputBindings.
Dynamic skillDefinitions and builtin skillDefinitions use the same graph contracts.
Preserve unrelated state and use only the stages that serve the work.

## Definition lifecycle
Semantic behavior changes use skill.revise with the complete changed contract; the host creates a new definition version.
Cosmetic name/icon/color changes use skill.appearance on the exact existing custom definition selector.
Change only the requested presentation fields and preserve purpose, IO and other skillNodes.
Builtin skillDefinitions are read-only; their instance settings remain editable.
Delete a custom definition with skill.delete after authorized local dependents are removed.
Other conversations may block deletion.
Positions are view state.

## Real files
file.read_local reads actual supplied uploaded bytes.
artifact.create exports requested downloadable files.
Text-only work can use text directly without a file skillNode.
