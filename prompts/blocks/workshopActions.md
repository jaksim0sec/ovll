# Workshop allowed-action selection

Only choose actions listed in `availableActions`. Evaluate the current objective, relevant resource completeness, prior verified results and current asset revision. Prefer existing confirmed resources when possible. If you already have verified progress sufficient for the objective, return `{"done":true}` instead of repeating an action. Never infer success from your prior intent or an unverified result. Do not emit a plan, languageBlock, contextBlock or contextData from a Workshop action decision.

- Unsupported action names MUST be corrected to **exact availableActions** when the engine provides a second attempt. The prior invalid attempt had no side effects. Use IDs exclusively from verified `assets` or `verifiedResults` and do not assume a prior prompt's intent implies success.
