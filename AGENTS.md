# AGENTS.md

This repository is the live ovll project.

## Source of truth

- The real execution branch is `main`.
- Treat `main` as the default and authoritative branch for all work.
- Do not create, switch to, or work on temporary/feature branches unless the user explicitly asks for a branch.
- Do not assume an old PR branch is still relevant after merge.

## Git workflow

- Minimize pushes because Git pushes can trigger Vercel deployments.
- Do not make intermediate commits while implementing a task.
- Batch all related file changes into one final atomic commit whenever possible.
- Prefer Git blob/tree/commit operations for multi-file changes so the whole task lands as one commit.
- Update the `main` ref only after the task is ready.
- Do not create a PR unless the user explicitly asks for one.
- Progress updates are conversational only and must not imply intermediate Git commits.

## Deployment discipline

- Avoid unnecessary Vercel deployments.
- Assume each push to a connected branch may trigger a deployment.
- Keep automatic deployment activity focused on `main`.
- If Vercel configuration is changed, prefer disabling automatic deployments for non-main branches.
- Check for duplicate Vercel projects connected to the same repository before increasing deployment activity.
- Do not manually trigger deployments unless required by the task or explicitly requested.

## Project structure

- Server entry: `server.js`
- Frontend files: `front/`
- Do not use additive patch-on-patch coding when a cleaner replacement/refactor is appropriate.
- Preserve the existing architecture and reuse current components, SVG conventions, stores, and runtime systems where practical.

## Versioning

- When a deployed application update changes `server.js` or ships frontend/backend behavior, bump `APP_VERSION` in `server.js`.
- Never forget the version bump for a production-facing update.

## Supabase

- Supabase MCP is connected and should be used directly for Supabase work when available.
- The currently discoverable Supabase project is `bapsang` with project ref `akuqtolnofdutzumgxsa`.
- Verify the intended project before destructive or project-specific changes.
- For schema/security work, verify changes and check RLS/security implications.
- Never expose service-role or secret keys to frontend code.

## Vercel connection

- Do not assume the Vercel MCP/app is connected.
- If live Vercel account/project access is needed, verify connector state first.
- If no teams/projects are visible, explain that the Vercel connector needs user authorization rather than guessing project settings.

## Validation

- Run or inspect relevant tests before the final commit when feasible.
- Prefer fixing validation failures before touching `main`.
- Do not create extra branches merely to run tests.
- Keep the final Git history compact: ideally one task, one commit.

## Communication

- Keep progress percentages in chat for longer tasks.
- Do not equate progress updates with Git operations.
- If a task would require a different branch, multiple deployment-triggering pushes, or a workflow exception, mention it before doing so.
