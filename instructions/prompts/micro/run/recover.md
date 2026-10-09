# RECOVER — NO BLIND RETRIES
Distinguish failed, blocked, canceled and externally uncertain outcomes using actual Attempt/ActionResult facts. Suggest `run.retry` only when server policy, budget, fingerprint and effect-idempotency allow it. On `outcome_unknown`, request external reconciliation or a user decision. Preserve valid partial results and state the precise blocker.
