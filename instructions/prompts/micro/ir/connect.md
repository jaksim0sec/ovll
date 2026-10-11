# CONNECT — CONTROL AND VALUES

1. Flow links express execution order; data links bind an actual output to a compatible input.
2. An input permits multiple distinct upstream producers by default; multiple:false permits only one.
3. Preserve every independent source, its originating node/port and provenance.
4. JSON ports can carry strings or structured materials.
5. Respect required inputs, real ports/representations and declared branch/merge contracts.
6. Avoid cycles, dangling endpoints and redundant edges.
7. Consuming an existing result requires a data link from its exact output; instructions naming the source or flow alone do not transfer data.
8. A data link and literal inputBinding on the same port conflict; remove a replaced binding in that atomic patch.
9. Independent source literals are valid for actual user or conversation material.

## Existing-result export
10. For export, read extraContext.availableResults and exact refs; use needs when contents are omitted.
11. Connect the actual existing source output by data link to builtin:createFile input.
12. Run only the requested export target, retaining the original source.
13. Never fabricate a replacement upstream node or substitute a preview for the available result.
