# PLAN.md — Implementation Steps

> Input: `SETUP.md`. Each step is scoped to fit **one prompt/session** and ends with a
> **testable result**. Automated tests are mandatory for every code step — run them
> before declaring the step done.
>
> **Test tooling convention:** server tests use **Vitest** (Node 22+, ESM).
> Angular client tests also use **Vitest** — Angular 22's `ng test` ships Vitest-based
> (vitest + jsdom) by default; no Jasmine/Karma. Run client tests via
> `pnpm --filter client exec ng test --watch=false` (pnpm flag-passing quirk).
> Server HTTP tests use Hono's built-in `app.request()` — no running server needed.
>
> **Fallback trigger (decision gate):** Mastra (`@ag-ui/mastra@2.0.2`) is the
> documented fallback for TanStack AI. Trigger it if **Step 8 (SSE endpoint) or
> Step 14 (real-model E2E) cannot be completed with TanStack within one
> iteration** — otherwise continue on TanStack. The fallback is actionable, not
> aspirational: at that point, replace `agent.ts` + `chat-route.ts` with the
> Mastra agent + `@ag-ui/mastra` bridge; Steps 5–6 (A2UI wrapper + tool) and the
> whole client track are unaffected.

---

## Phase 0 — Foundation

### Step 1: Version alignment check (Step 0 from SETUP.md §5) — ✅ DONE (2026-11-05)
- **Was:** Check peer-dependency compatibility across the agent SDK, its OpenRouter adapter, and the AG-UI integration.
- **Result (TanStack AI chosen):**
  - `@tanstack/ai@1.1.0` — stable 1.0 line; peer: `@opentelemetry/api >= 1.9.0`
  - `@tanstack/ai-openrouter@1.1.0` — peers `@tanstack/ai@^1.1.0` ✅
  - `@tanstack/ai-angular@1.0.1` — peers `@tanstack/ai@^1.0.1`, `@angular/core >= 21` ✅
  - TanStack AI is **natively AG-UI compliant in both directions** — no bridge or adapter needed.
  - ⚠️ ~~Open verification item~~ → **RESOLVED (2026-11-05, see SETUP.md §5):** TanStack AI natively speaks AG-UI (event types imported from `@ag-ui/core`), but server-side `chat()` emits tool results as `TOOL_CALL_RESULT` — **not** `ACTIVITY_SNAPSHOT`. The small `a2ui-snapshot.ts` mapping (part of Step 8) **is required**.
  - Evaluated alternatives: `@openrouter/ai-sdk-provider@3.1.0` (v7-only, no AG-UI adapter exists — `@ag-ui/vercel-ai-sdk` is an unmerged roadmap item, ag-ui issue #933 / PR #1626); `@ag-ui/mastra@2.0.2` (published Mastra fallback).
- **Consequence:** TanStack AI is the primary server stack. Fallback: Mastra if TanStack proves too immature.
- **Testable result:** Version matrix recorded in `SETUP.md` §5 Step 0.

### Step 2: Monorepo scaffold — ✅ DONE (2026-11-05)
- **Do:** Root `package.json` + `pnpm-workspace.yaml` with pnpm workspaces `server/` + `client/`, root `.gitignore` (node_modules, dist, .env), root `.editorconfig`. Create `server/` with its `package.json` (type: module, scripts: `dev`, `test`, `build`), `tsconfig.json` (NodeNext), install Vitest + tsx. Add a trivial smoke module + test.
- **Result:** Scaffold created. pnpm 12 note: build-script approval uses `allowBuilds` (mapping) in `pnpm-workspace.yaml` — `esbuild: true` added; future steps that add packages with postinstall scripts (e.g. Angular CLI) may need more entries there.
- **Deliverable:** `server/` boots `vitest run` green.
- **Automated tests:** `server/src/smoke.test.ts` — asserts the smoke module exports the expected value. ✅ 2/2 passed (vitest 5.1.0).
- **Verify:** `pnpm --filter server test` passes; `pnpm --filter server build` (tsc) compiles clean.

### Step 3: Server HTTP skeleton (Hono) — ✅ DONE (2026-11-05)
- **Do:** `server/src/index.ts` with Hono app + `GET /health` returning `{ status: 'ok' }`. Export the app instance (so tests don't need a listening port). Add `@hono/node-server` entry (`server/src/main.ts`) that serves it on port 8787.
- **Result:** Implemented as planned. Note: TypeScript 7 (native compiler) requires an explicit `"types": ["node"]` in tsconfig — `@types/node` auto-inclusion did not kick in.
- **Deliverable:** Health endpoint.
- **Automated tests:** `server/src/index.test.ts` — `app.request('/health')` returns 200 and JSON body `{ status: 'ok' }`. ✅ 3/3 passed (2 smoke + 1 health).
- **Verify:** `pnpm --filter server test` passes ✅; `pnpm --filter server build` compiles clean ✅; `pnpm --filter server dev` + `curl localhost:8787/health` → `{"status":"ok"}` HTTP 200 ✅.

### Step 4: Angular client scaffold — ✅ DONE (2026-11-05)
- **Do:** `ng new client` (standalone, no SSR) inside the workspace; register it as a workspace package. Add Angular Material (`ng add @angular/material`) with a prebuilt theme. Keep the default app component rendering.
- **Result:** Scaffolded with **Angular 22.2** (standalone, no SSR, pnpm package manager). `ng test` ships **Vitest-based** (vitest + jsdom) — matches the server convention, no Jasmine/Karma. Material added manually (v22 M3 prebuilt theme `azure-blue.css`, `provideAnimationsAsync()`, Roboto + Material Icons fonts); `ng add` was skipped in favor of direct installs. Notes: (a) `@angular/animations` had to be added explicitly (not in the default scaffold, required by `provideAnimationsAsync`); (b) `allowBuilds` gained `@parcel/watcher`, `lmdb`, `msgpackr-extract`; (c) pnpm flag-passing quirk — use `pnpm --filter client exec ng test --watch=false`, not `pnpm --filter client test -- --watch=false`.
- **Deliverable:** Angular app builds and its default test suite passes.
- **Automated tests:** The scaffold's initial `app.spec.ts` (renders, title check). ✅ 2/2 passed (vitest 5.1.0).
- **Verify:** `pnpm --filter client build` ✅ (1.1s); `pnpm --filter client exec ng test --watch=false` ✅; `ng serve` on :4200 → HTTP 200 with `<app-root>` ✅.

---

## Phase 1 — Server core (A2UI + agent + AG-UI endpoint)

### Step 5: A2UI integration via official `@a2ui/agent` SDK — ✅ DONE (2026-11-05)
- **Do:** `server/src/a2ui/index.ts` — thin wrapper around `@a2ui/agent@0.1.0` (published 2026-11-02, deps `@a2ui/web_core@^0.15.0`): load the Basic Catalog from the official spec JSON, export `validateA2uiPayload(ops)` (→ SDK `validatePayload([catalog], ops)`, throws converted to `{ok, errorText}`) and `getPromptSnippet()` (→ `DirectJsonPromptGenerator.generate()` — ~40KB of format rules + protocol/catalog schemas + examples). Validation, prompt content, and catalog handling come from the official SDK — spec-exact by construction; a spec bump = SDK version bump.
- **Fixtures:** `server/src/a2ui/spec/` holds `catalog.json` (the catalog source the SDK loads) and `example-login-form.json` (official example, used as a test fixture).
- **Verified API surface (against the installed SDK):** `validatePayload(catalogs, messages)` throws on invalid payloads; `CatalogConfig.fromPath` requires an explicit `'v0.9'` (the v0.9 catalog document does not state a protocol version); the loaded catalog exposes `components`/`functions` as **Maps** (18 / 14 entries) and `protocolVersion: 'v0.9'`; the message envelope carries `version` at the **message level** (`{version: 'v0.9', createSurface: {...}}`), not inside the payload key.
- **Import-hygiene rule:** the SDK chain uses Zod 3 while our TanStack-facing code uses Zod 4 (dual install, isolated by pnpm — see SETUP.md risk table). The integration boundary is plain JSON (tool arguments), never Zod schema objects — never import Zod-typed values from the SDK chain into TanStack-facing code.
- **Automated tests:** `server/src/a2ui/index.test.ts` — catalog load (Map, 18 components, `protocolVersion: 'v0.9'`), official example passes, unknown component rejected with usable error text, missing version rejected, broken payload rejected, prompt snippet >10KB containing message types + component names. ✅ 9/9 passed (3 files).
- **Verify:** `pnpm --filter server test` passes ✅; `pnpm --filter server build` compiles clean ✅.

### Step 6: `generate_ui` tool — ✅ DONE (2026-11-05)
- **Do:** `server/src/tools/generate-ui.ts` — TanStack `toolDefinition()` with a **minimal Zod envelope** (`z.object({ operations: z.array(z.unknown()) })` — the real validation moves into the handler). `.server()` handler calls `validateA2uiPayload(operations)` from the Step 5 wrapper: valid → return `{ status: 'ok', operations }`; invalid → return `{ status: 'error', errorText }` with the SDK's error text so the model can retry (TanStack's agent loop gives the retry behavior for free). Keep it side-effect-free (POC: no persistence). ✅ Implemented; `outputSchema` is a discriminated union typing both branches (TanStack validates tool results against it before sending them back to the model).
- **Verification item — RESOLVED:** `toolDefinition()` **does accept plain JSON Schema** for `inputSchema`/`outputSchema` (documented in the shipped source: "Supports any Standard JSON Schema compliant library (Zod v4+, ArkType, Valibot, etc.) or plain JSON Schema objects"). Kept the Zod envelope anyway: typed handler args + runtime output validation. A full-spec plain JSON Schema inputSchema would additionally require bundling the cross-referencing spec files into one `$defs` document (TanStack validates plain JSON Schema with `@cfworker/json-schema`, which dereferences refs but cannot fetch remote URLs) — not worth it for the POC; the system prompt carries the format knowledge.
- **Discoveries (verified against installed `@tanstack/ai@1.2.0`):**
  - TanStack AI **ships bundled agent skills** (`node_modules/@tanstack/ai/skills/ai-core/*/SKILL.md`) documenting its own API — `tool-calling`, `chat-experience`, `ag-ui-protocol`, etc. First-party reference for Steps 7/8.
  - **Input-validation errors go back to the model automatically** as the tool result (`Input validation failed for tool <name>: ...`) — the retry loop works at the envelope level too, not just for handler-returned errors.
  - Version note: `@tanstack/ai@1.2.0` published **today** (2026-11-05; fast churn confirmed); `@tanstack/ai-openrouter@1.1.1` is the matching adapter (peers `@tanstack/ai@^1.2.0`). Pinned exact versions in `server/package.json`.
- **Deliverable:** Tool module.
- **Automated tests:** `server/src/tools/generate-ui.test.ts` — (a) valid operations (official login-form fixture) → handler resolves `{ status: 'ok' }` ✅; (b) invalid operations (unknown component type) → `{ status: 'error' }` with non-empty error text ✅; (c) envelope-level rejection (non-array `operations`) via the Zod envelope's `safeParse` ✅; (d) missing `operations` rejected ✅; (e) outputSchema accepts both result branches ✅.
- **Verify:** `pnpm --filter server test` passes ✅ (14/14, 4 files); `pnpm --filter server build` compiles clean ✅.

### Step 7: Agent definition with mock adapter — ✅ DONE (2026-11-05)
- **Do:** `server/src/agent.ts` — TanStack `chat()` with the `openRouterText` adapter from `@tanstack/ai-openrouter`, **system prompt**, tools, and max-steps loop guard. Read model id from `OPENROUTER_MODEL` env with a default. Structure the file so the **adapter can be injected** (factory function `runUiAgent(messages, threadId, adapter?)`) — this is what makes the agent testable without an API key.
- **System prompt (first-class deliverable):** `server/src/agent-prompt.ts` — `buildSystemPrompt()` assembles the prompt from: (a) role + tool contract ("generate UIs by calling `generate_ui` with A2UI operations"); (b) **`getPromptSnippet()` from the Step 5 wrapper** — the SDK generates the format rules, catalog schemas, and examples from the loaded catalog (the officially recommended prompt content; larger than a hand-written summary — accepted trade-off); (c) guardrails (only catalog components, keep surfaces small, update existing surfaces instead of recreating). Pass it to `chat()` via the `systemPrompts` option (TanStack's `ModelMessage` has no system role).
- **Mock adapter (use what ships):** `@tanstack/ai` ships a **`testing/` directory** (e.g. `fake-text.js`) — check it first and use its fake adapter; only implement a minimal fake (scripted stream implementing the adapter interface) if the shipped one doesn't cover the tool-call scripting we need.
- **Deliverable:** Agent factory + prompt builder module.
- **Automated tests:** `server/src/agent.test.ts` with the mock adapter: (a) a scripted model response that calls `generate_ui` with valid ops → agent loop executes the tool and finishes with the tool result in the message history; (b) scripted response with **invalid** tool args → the loop surfaces the validation error to the model; (c) a plain text response → no tool call, loop ends after one step. Plus `server/src/agent-prompt.test.ts`: the built prompt contains the tool name, the SDK prompt snippet content, and the guardrails.
- **Verify:** `pnpm --filter server test` passes. No `OPENROUTER_API_KEY` needed for these tests.
- **Result:** ✅ 21/21 tests passed (6 files); `pnpm --filter server build` compiles clean. Findings: `fakeText()` from `@tanstack/ai/testing` covers tool-call scripting (scripted steps + request capture via `state.callCount`); `chat()` emits AG-UI events natively (`RUN_STARTED`, `TOOL_CALL_START/ARGS/END`, `TOOL_CALL_RESULT` with `content` as a JSON string, `TEXT_MESSAGE_*`, `RUN_FINISHED`); the `maxIterations` guard cuts the stream after the final `TOOL_CALL_RESULT` without a trailing text turn. The `openRouterText()` model parameter is typed as a union of known model IDs — `OPENROUTER_MODEL` env string is cast to the default's literal type (runtime value is what matters; a wrong slug fails at request time).

### Step 8: A2UI snapshot mapping + AG-UI `/chat` endpoint (SSE) — ✅ DONE (2026-11-05)
- **Do (part 1 — snapshot mapping):** `server/src/a2ui-snapshot.ts` — a small stream transform that intercepts the `generate_ui` tool result (`TOOL_CALL_RESULT`) in the `chat()` stream and emits an `ACTIVITY_SNAPSHOT` event with `activityType: 'a2ui-surface'` carrying the A2UI operations. Use `@ag-ui/core` event types so the output is type-safe (**`@ag-ui/core@1.0.0` is a direct server dependency** — pinned exact to match TanStack's own transitive copy; pnpm's strict isolation forbids importing undeclared transitive deps). (Alternative native paths noted in SETUP.md §5: `ctx.emitCustomEvent` and `ActivityPart` — the transform remains the simplest fit for the CopilotKit convention.)
- **Do (part 2 — endpoint):** `server/src/chat-route.ts` — `POST /chat` accepting AG-UI `RunAgentInput`, running the TanStack `chat()` stream (Step 7) through the snapshot mapping and returning it as an SSE response (TanStack's `toServerSentEventsResponse` or equivalent — verify exact API against installed docs). Wire into `index.ts` with CORS for `http://localhost:4200` (env-overridable). On agent failure, emit an AG-UI `RUN_ERROR` event instead of an HTTP 500 mid-stream.
- **Deliverables:** Snapshot mapping module + streaming AG-UI endpoint.
- **Automated tests:** `server/src/a2ui-snapshot.test.ts` — with the mock adapter from Step 7: (a) a scripted tool-call run yields an `ACTIVITY_SNAPSHOT` containing the A2UI ops; (b) a run without tool calls passes through unchanged; (c) every emitted event passes `@ag-ui/core` validation. Plus `server/src/chat-route.test.ts` — build the app with the **mock adapter** injected (factory from Step 7): (a) POST a minimal `RunAgentInput` → response is `text/event-stream`; (b) parse the SSE frames and assert the event sequence contains `RUN_STARTED`, `TOOL_CALL_START` (name `generate_ui`), `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `ACTIVITY_SNAPSHOT`, `TEXT_MESSAGE_*`, `RUN_FINISHED` — **strictly ordered within each group** (`RUN_*` first/last, the `TOOL_CALL_*` cluster together), but **order-insensitive between the `ACTIVITY_SNAPSHOT` and `TEXT_MESSAGE_*` groups** (whether the model calls the tool before or after its text summary depends on the scripted fixture — the fixture pins one order, the assertion tolerates both); (c) malformed body (missing `messages`) → 400 before the stream starts.
- **Verify:** `pnpm --filter server test` passes; manual `curl -N -X POST localhost:8787/chat -d '{...}'` shows streaming frames.
- **Result:** ✅ 33/33 tests passed (8 files); build clean; live smoke: `/chat` streams `RUN_ERROR` in-band when `OPENROUTER_API_KEY` is missing (no HTTP 500), CORS preflight 204. Key findings: (1) **TanStack bundles its own AG-UI event interfaces** — nominally distinct from `@ag-ui/core`'s despite identical runtime shapes; the server pipeline is typed with TanStack's types (`StreamChunk`, re-exported `EventType`), `@ag-ui/core` is used for input validation (`RunAgentInputSchema` from `@ag-ui/core/schemas`) and contract tests only. (2) **AG-UI → TanStack message adapter** (`toModelMessages`): AG-UI `Message` has 7 roles (incl. `developer`/`system`/`activity`/`reasoning`) vs TanStack's 3 (`user`/`assistant`/`tool`) — non-model roles are skipped; `AssistantMessage.content` is optional (toolCalls-only); AG-UI 1.0 `TextPart` carries `.text` (not `.content`). (3) **Actual event order:** the orchestrator emits `TOOL_CALL_START/ARGS/END`, then the turn's `RUN_FINISHED`, then `TOOL_CALL_RESULT` — the `TOOL_CALL_RESULT` comes *after* the first turn's `RUN_FINISHED`, not clustered with `START/ARGS/END`. (4) SSE frames are `data: {json}\n\n`, spec-stripped by TanStack's `toWireChunk`.

### Step 9: Server contract test against real AG-UI types — ✅ DONE (2026-11-05)
- **Do:** Add a test that validates the emitted SSE events against the actual `@ag-ui/core` event schemas (import the zod/event validators from `@ag-ui/core` if exported; otherwise parse with their TS types + minimal runtime checks). This pins our `ACTIVITY_SNAPSHOT`/`a2ui-surface` convention in code (SETUP.md §2.3).
- **Deliverable:** Contract test module.
- **Automated tests:** `server/src/agui-contract.test.ts` — run the Step 8 stream (mock adapter) and assert every emitted event passes the AG-UI event validation, and that the A2UI ops inside the snapshot are accepted by `validateA2uiPayload` (Step 5 wrapper).
- **Verify:** `pnpm --filter server test` passes.
- **Result:** ✅ 37/37 tests passed (9 files); build clean. `@ag-ui/core/schemas` exports `EventSchema` (discriminated union of all event schemas) and `ActivitySnapshotEventSchema` — used directly. The contract test validates the **actual SSE wire frames** (post-`toWireChunk` spec-stripping) byte-for-byte: all frames pass `EventSchema`; the single `ACTIVITY_SNAPSHOT` passes `ActivitySnapshotEventSchema` with `activityType: 'a2ui-surface'` and its `content.operations` re-validate via `validateA2uiPayload`; the `RUN_ERROR` failure path also passes. Shared test helpers (`mockUiAgentAdapter`, `makeRunAgentInput`, `parseSseFrames`) moved to `test-fixtures.ts` (DRY).

---

## Phase 2 — Client core (CopilotKit + A2UI rendering)

### Step 10: CopilotKit wiring + chat panel
- **Do (install first):** `pnpm --filter client add @copilotkit/angular @ag-ui/client` — CopilotKit Angular is young and may bring peer-dependency surprises (the class of issue Step 1 exists to catch); if pnpm reports peer conflicts or ignored build scripts, resolve them explicitly (add entries to `allowBuilds` in `pnpm-workspace.yaml` as needed) and record the versions. Then `client/src/app/app.config.ts` — `provideCopilotKit({ agents: { uiAgent: new HttpAgent({ url: 'http://localhost:8787/chat' }) } })` (URL from an environment/config file). Render `<copilot-chat agentId="uiAgent" />` in the app component inside a simple two-pane layout.
- **Deliverable:** Chat that talks to the server.
- **Automated tests:** `app.component.spec.ts` — component renders the chat element; config provider supplies an agent named `uiAgent`. (Live streaming is verified manually in Step 14.)
- **Verify:** `pnpm --filter client exec ng test --watch=false` passes; with server running, sending a message in the browser shows a streamed text response (manual smoke).

### Step 11: A2UI renderer configuration (Basic Catalog)
- **Do:** `client/src/app/a2ui/catalog.ts` — register `@a2ui/angular` renderer: `A2UI_RENDERER_CONFIG` provider with `BasicCatalog`, expose `A2uiRendererService` + `SurfaceComponent` setup. Install `@a2ui/angular` + `@a2ui/web_core` (versions pinned from Step 1).
- **Deliverable:** Renderer config module.
- **Automated tests:** `client/src/app/a2ui/catalog.spec.ts` — a test component using the surface renders a **hardcoded static A2UI document** (e.g. a Column with a Text and a Button) without errors; assert the rendered DOM contains the expected text.
- **Verify:** `pnpm --filter client exec ng test --watch=false` passes.

### Step 12: Activity renderer (`a2ui-surface` → A2UI)
- **Do:** `client/src/app/a2ui/activity-renderer.component.ts` — CopilotKit activity renderer registered for `activityType: 'a2ui-surface'`: extracts A2UI operations from `ACTIVITY_SNAPSHOT` content and feeds them to `A2uiRendererService`. Wire A2UI Actions (button clicks etc.) to post a new user message back to the agent.
- **Deliverable:** Activity renderer component.
- **Automated tests:** `activity-renderer.spec.ts` — (a) given a mock snapshot with valid ops, the component renders the corresponding components (DOM assertions); (b) given an invalid/unknown activityType, it renders nothing and logs a warning; (c) clicking a rendered Button emits the expected action payload (spy on the message-posting service).
- **Verify:** `pnpm --filter client exec ng test --watch=false` passes.

### Step 13: Material app shell
- **Do:** `app.component.*` — Material shell per SETUP.md §7.3: `mat-toolbar` ("Prompt CMS"), two-pane layout (chat left, generated-UI surface right), basic theming/responsive split. No business logic — pure presentation.
- **Deliverable:** Styled shell.
- **Automated tests:** Update `app.component.spec.ts` — toolbar renders title; both panes exist; layout classes applied.
- **Verify:** `pnpm --filter client exec ng test --watch=false` passes; visual check via `pnpm --filter client start`.

---

## Phase 3 — Integration & hardening

### Step 14: End-to-end smoke (manual, real model)
- **Do (one-time env setup — ✅ DONE 2026-11-05):** Root `.env` (gitignored, user-created) + `.env.example` with `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. Loaded via Node's built-in flag in the server dev script — no `dotenv` dependency: `"dev": "tsx watch --env-file-if-exists=../.env src/main.ts"`. Verified: both vars load (quotes stripped by Node's parser), server boots with no key error. Documented in SETUP.md §8.
- **Do (main):** With `OPENROUTER_API_KEY` set (never committed; `.env` gitignored), run server + client and drive the **5-prompt canned suite** below. Confirm: streamed chat text, generated UI appears in the right pane, a follow-up prompt updates the UI, and a button click in the generated UI round-trips to the agent.
- **Pass criteria (measurable, not vibes-based):**
  1. All 5 prompts complete a run with `RUN_FINISHED` (no `RUN_ERROR`).
  2. **≥ 4 of 5 prompts produce a valid A2UI surface on the first tool call** (no validation-retry needed — observable via the server log or by counting `TOOL_CALL_START` events per run).
  3. At least one follow-up prompt **updates** an existing surface (not a fresh one).
  4. At least one button click in the generated UI round-trips to the agent and produces a visible response.
  - If criterion 2 fails, this is the **prompt-iteration loop**: refine `agent-prompt.ts` (tool contract wording, guardrails) and re-run the suite until it passes — record what worked in the prompt module.
- **Canned prompt suite:** (1) "Build me a dashboard for server metrics"; (2) "Create a login form with username and password fields"; (3) "Add a status card showing CPU usage to the dashboard" (follow-up to 1); (4) "Make a settings page with a theme choice picker"; (5) "Show a list of three sample users with names and emails".
- **Deliverable:** Working end-to-end POC.
- **Testable result:** The full message-flow walkthrough from SETUP.md §3 is observed in the browser. Record the observed event sequence (browser devtools → network → SSE) and paste it into `SETUP.md` §3 as a validation note.
- **Note:** This step is manual by design — it validates the real-model path that mock tests can't cover.

### Step 15: Automated end-to-end test (server-side, real protocol)
- **Do:** Add an integration test that boots the real Hono app (mock adapter) and drives it exactly like the Angular client does — using `@ag-ui/client`'s `HttpAgent` pointed at the in-process server (or a `node:http` listener on an ephemeral port). Assert the client-side event stream matches the server contract. **Install `@ag-ui/client` as a server devDependency first** (`pnpm --filter server add -D @ag-ui/client`) — pnpm's strict isolation forbids importing it transitively.
- **Deliverable:** Client-protocol-level integration test.
- **Automated tests:** `server/src/e2e-agui.test.ts` — `HttpAgent.runAgent()` completes; subscriber receives the full expected event sequence; no `RUN_ERROR`.
- **Verify:** `pnpm --filter server test` passes (this closes the loop: the same code path the browser uses is now under automated test).

### Step 16: Polish + documentation
- **Do:** Root `README.md` (run instructions from SETUP.md §9, env vars from §8, test commands per workspace). Update `SETUP.md` status from "Plan" to "Implemented (POC)". Clean up TODOs, ensure all tests green in both workspaces, commit.
- **Deliverable:** Final POC state.
- **Testable result:** `pnpm --filter server test` and `pnpm --filter client exec ng test --watch=false` both pass; `git status` clean after commit.

---

## Dependency graph

```
Step 1 ─► Step 2 ─► Step 3 ─┐
                └─► Step 4 ─┤
                            ├─► Step 10 ─► Step 13 ─┐
        Step 5 ─► Step 6 ─► Step 7 ─► Step 8 ─► Step 9 ─┤
                            │                           ├─► Step 14 ─► Step 15 ─► Step 16
                            └───────────────────────────┴─► Step 11 ─► Step 12 ─┘
```

Steps 3/4 can run in parallel after Step 2. Steps 10–12 (client) and 5–9 (server) are
independent tracks; both must finish before Step 14.

---

## Test summary (what "done" means per phase)

| Phase | Automated | Manual |
|---|---|---|
| 0 | Smoke tests (server + client scaffold) | — |
| 1 | A2UI wrapper (SDK), tool, agent (mock adapter), snapshot mapping, SSE route, AG-UI contract tests | `curl` SSE stream |
| 2 | Component tests (catalog, activity renderer, shell) | Browser chat smoke |
| 3 | `HttpAgent` end-to-end integration test | Real-model E2E walkthrough |
