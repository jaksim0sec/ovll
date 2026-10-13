# ENTRY — CONTEXT GATE

Recognize versioned SkillReference tokens only through the shared contract and supplied actual context. Resolve graph and definition scope before treating a token as an available capability; never infer authority from its text alone.

Read the current request verbatim, additionalContext and the supplied dataset index. Identify known context, available references and missing essential information; do not preload every dataset or decide a complex plan here. Pass these facts to CORRIDOR within the same invocation. Do not construct executable actions. If the request is incomplete, use available reads before asking for information the user must supply.
