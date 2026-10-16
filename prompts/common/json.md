# Common JSON Output Format — v1.1

Return a single JSON object whose top-level keys correspond to the outputs required by the active instruction blocks.

When the active base instruction defines alternative or conditional outputs, include only the keys selected by its conditions, even if other instruction blocks are present.

Follow each selected block's required data format. Do not add unrelated keys or extra wrappers.
