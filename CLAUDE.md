# CLAUDE.md

## Package Manager

**Always use pnpm** (not npm or yarn) for this project:

- Install dependencies: `pnpm install`
- Add a dependency: `pnpm add <pkg>` (or `pnpm add -D <pkg>` for dev dependencies)
- Run scripts: `pnpm run <script>` or `pnpm <script>`
- Workspace commands: `pnpm --filter <workspace> <script>` (e.g. `pnpm --filter server test`)
- Registry queries: `pnpm view <pkg> <field>`

This applies to all agents and sessions working in this repository.

## Project

POC: AI agent that builds web UI on the fly from a user prompt. See `SETUP.md` for
architecture and stack decisions, `PLAN.md` for the implementation steps.

- `server/` — Node.js + Hono, TanStack AI (`@tanstack/ai` + `@tanstack/ai-openrouter`), AG-UI SSE endpoint
- `client/` — Angular, CopilotKit, A2UI renderer

## Environment Notes

- Node is installed via nvm (`~/.nvm/versions/node/v26.13.0/bin`); it may not be on
  the default shell PATH — prepend it when running shell commands.
- `OPENROUTER_API_KEY` is required for real-model runs; never commit it.
