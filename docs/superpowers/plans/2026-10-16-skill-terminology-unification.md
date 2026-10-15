# Skill terminology unification — isolated implementation

**Goal:** Use one vocabulary directly in the existing implementation. A skill is an action definition; a skill node is a placed instance of that definition. Remove continuous Skill/Node translation without replacing the graph, scheduler, compiler, or UI architecture.

**Approved scope:** The user's 2026-10-16 request authorizes trying the previously discussed direct rename in an independent branch. Preserve main, existing IDs, ports, revisions, execution authorization, validation and failure handling. Report blockers rather than hiding them behind another facade.

**Execution:** Inline. Base: `c0f9c8bc3085f4a306785d531de4efc02db38ef6`. Branch: `codex/skill-terminology-unification`.

## Vocabulary

| Meaning | Runtime name |
|---|---|
| Defined skill | `skillDefinitions`, `definitionId`, `skillDefinitionRef` |
| Placed instance | `skillNodes`, `skillNodeId`, `skillNodeRef`, `localSkillNodeKey` |
| Definition operations | `skill.define`, `skill.revise`, `skill.appearance`, `skill.delete` |
| Instance operations | `skillNode.add`, `skillNode.update`, `skillNode.delete` |

Generic DOM node APIs and Node.js built-in imports are outside the domain vocabulary. User-owned settings, input values, output values and source code are opaque and must never be recursively renamed. Stored ID values and reference token text remain stable.

## Tasks

- [x] B1: Create the isolated branch/worktree and run the unchanged suite. Baseline: 881 passed, 0 failed.
- [x] B2a: Add a behavioral regression proving that the original graph repository directly supports two independently editable skill nodes sharing one definition. Watch it fail on main.
- [x] B2b: Rename the existing domain contracts, kernel, compiler, scheduler, model host and UI consumers together. Remove wrappers once callers use the shared contract directly. Preserve validation; no new execution subsystem.
- [x] B2c: Replace storage round trips with a canonical runtime and one-way historical import. Preserve original storage bytes, storage revisions and optimistic concurrency. Historical result fingerprints retain their original byte contract.
- [ ] B3: Run the full suite, syntax/asset checks, old workspace imports, reference round trips and a browser smoke flow. Inspect the diff and residual vocabulary. Commit and preserve the independent branch without merging or deploying.

## Review focus

- Two instances of the same skill retain distinct identity and settings.
- Opaque user objects containing old-looking keys are unchanged.
- Existing v9/v10 workspaces reopen with connections, runs, functions and references intact.
- Unchanged results remain reusable; changed instructions or inputs invalidate evidence.
- Browser assets, HTTP contracts and schema validators agree on the same vocabulary.

## Progress and decisions

- Baseline dependency installation succeeded; all 881 existing tests passed.
- Use explicit `skillDefinitions` rather than overloading `skills` for either definitions or instances. This keeps current definition IDs stable and avoids broadening the change into an identity redesign.

- Removed the transitional graph repository, execution facade, evidence facade, action-plan translator, staging-only storage bridge and their boot assets. Native validation remains; no fallback Node execution endpoint remains.
- Ruling: historical fingerprint JSON labels are immutable serialization literals, retained inside the digest implementation. No old graph object is constructed or executed. Changing these labels would invalidate valid saved results.
- Ruling: browser workspace storage uses schema 11 and a separate v3 key; saved functions and custom skills use new keys with one-way import. Original keys remain intact. Incomplete unverified function drafts are preserved; execution still uses the existing validators.
- Offline SQL migration 004 renames persisted domain columns and graph snapshots transactionally; active runs must be drained first. PGlite verification imported an original graph, restored it in the native kernel, applied an edit, preserved opaque payloads and reapplied the migration idempotently. No user's database was modified.
- Independent review found one Important issue: nested saved-run snapshots/output bindings/coverage retained historical keys. Added a realistic v9/v10 regression, observed its failure, migrated only those paths, and passed all seven migration/evidence tests.
- JavaScript syntax: 81 source files checked, zero failures. Full precommit suite: 862/864 passed; two pinned-Git transport tests still archive the unchanged HEAD and must be rerun after committing the candidate.

## Final local verification

- Full candidate-commit suite: **865 passed, 0 failed** (`npm test`, ~10 seconds). Retired facade-specific tests were replaced by native kernel/contract tests and realistic one-way import/evidence regressions.
- Headless Chromium smoke: complete application boot, two independently placed instances, styled canvas DOM, native browser → HTTP → model-host → validated response using one deterministic fixture-provider call, explicit save and reload with identical IDs; **0 page errors**. The fixture provider does not verify a live Gemini/Groq response.
- Offline PostgreSQL migration was tested using PGlite; no deployed PostgreSQL instance or in-flight production worker was changed. Real SQL opt-in deployment still requires draining active runs and applying migration 004 before new workers.
- `git diff --check` and 81 JavaScript syntax checks passed. The retired wrappers/imports are absent from active assets.
- Remote main and the new remote branch still point to the original base. Automatic approval review rejected the Git push because it considered source publication outside the explicit branch-creation authorization. The completed commit remains on the isolated local branch; remote publication awaits explicit user approval. No alternate upload path was attempted.
