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

---

## Phase 0 — Foundation

### Step 1: Version alignment check (Step 0 from SETUP.md §5) — ✅ DONE (2026-11-05)
- **Was:** Check peer-dependency compatibility across the agent SDK, its OpenRouter adapter, and the AG-UI integration.
- **Result (TanStack AI chosen):**
  - `@tanstack/ai@1.1.0` — stable 1.0 line; peer: `@opentelemetry/api >= 1.9.0`
  - `@tanstack/ai-openrouter@1.1.0` — peers `@tanstack/ai@^1.1.0` ✅
  - `@tanstack/ai-angular@1.0.1` — peers `@tanstack/ai@^1.0.1`, `@angular/core >= 21` ✅
  - TanStack AI is **natively AG-UI compliant in both directions** — no bridge or adapter needed.
  - ⚠️ ~~Open verification item~~ → **RESOLVED (2026-11-05, see SETUP.md §5):** TanStack AI natively speaks AG-UI (event types imported from `@ag-ui/core`), but server-side `chat()` emits tool results as `TOOL_CALL_RESULT` — **not** `ACTIVITY_SNAPSHOT`. The small `a2ui-snapshot.ts` mapping (Step 8a) **is required**.
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

### Step 5: A2UI operations Zod schema
- **Do:** `server/src/a2ui/schema.ts` — Zod schemas mirroring the A2UI v0.9 protocol messages needed for the POC: `beginRendering`, `updateComponents` (component tree: Text, Row, Column, Image, Button, TextInput, etc.), `updateDataModel`. Derive the JSON Schema representation for the tool definition from the Zod schema (`z.toJSONSchema`). Isolate all A2UI-spec knowledge in this module (per SETUP.md risk mitigation).
- **Deliverable:** Validated schema module **plus a compact prompt summary export** (`a2uiPromptSummary` — a short text/JSON description of the message structure and available components, consumed by the system prompt in Step 7).
- **Automated tests:** `server/src/a2ui/schema.test.ts` — (a) a minimal valid A2UI message list parses; (b) a component with an unknown type is rejected; (c) a component tree with a cycle/missing required fields is rejected; (d) JSON Schema generation produces an object with `type: 'object'`; (e) `a2uiPromptSummary` is a non-empty string mentioning the core message types and component names.
- **Verify:** `pnpm --filter server test` passes.

### Step 6: `generate_ui` tool
- **Do:** `server/src/tools/generate-ui.ts` — TanStack `toolDefinition()` with Zod `inputSchema` = A2UI operations schema from Step 5; `.server()` handler returns `{ status: 'ok', operations }`. Keep it side-effect-free (POC: no persistence).
- **Deliverable:** Tool module.
- **Automated tests:** `server/src/tools/generate-ui.test.ts` — (a) valid input → handler resolves with the operations echoed back; (b) invalid input → the tool-level validation rejects (test the schema's `safeParse` directly for the rejection paths).
- **Verify:** `pnpm --filter server test` passes.

### Step 7: Agent definition with mock adapter
- **Do:** `server/src/agent.ts` — TanStack `chat()` with the `openRouterText` adapter from `@tanstack/ai-openrouter`, **system prompt**, tools, and max-steps loop guard. Read model id from `OPENROUTER_MODEL` env with a default. Structure the file so the **adapter can be injected** (factory function `runUiAgent(messages, threadId, adapter?)`) — this is what makes the agent testable without an API key.
- **System prompt (first-class deliverable):** `server/src/agent-prompt.ts` — `buildSystemPrompt()` assembles the prompt from: (a) role + tool contract ("generate UIs by calling `generate_ui` with A2UI operations"); (b) the `a2uiPromptSummary` schema summary from Step 5 (message structure + Basic Catalog components); (c) 1–2 complete, valid **example A2UI surfaces** (few-shot anchors — the angular-architects reference credits examples + schema lookup as crucial for valid model output); (d) guardrails (only catalog components, keep surfaces small, update existing surfaces instead of recreating). Pass it to `chat()` via the `systemPrompts` option (TanStack's `ModelMessage` has no system role).
- **Deliverable:** Agent factory + prompt builder module.
- **Automated tests:** `server/src/agent.test.ts` using a **mock adapter** (check `@tanstack/ai` exports for a test/mock adapter; otherwise implement a minimal fake implementing the adapter interface that yields a scripted stream): (a) a scripted model response that calls `generate_ui` with valid ops → agent loop executes the tool and finishes with the tool result in the message history; (b) scripted response with **invalid** tool args → the loop surfaces the validation error to the model; (c) a plain text response → no tool call, loop ends after one step. Plus `server/src/agent-prompt.test.ts`: the built prompt contains the tool name, the schema summary, and at least one example surface.
- **Verify:** `pnpm --filter server test` passes. No `OPENROUTER_API_KEY` needed for these tests.

### Step 8a: A2UI snapshot mapping (`generate_ui` result → `ACTIVITY_SNAPSHOT`)
- **Do:** ~~First verify (Step 1 open item)~~ **Verified (Step 1, 2026-11-05):** `@tanstack/ai@1.1.0` does **not** emit `ACTIVITY_SNAPSHOT` for tool results — `buildToolResultChunks()` emits `TOOL_CALL_RESULT` events. So write `server/src/a2ui-snapshot.ts` — a small stream transform that intercepts the `generate_ui` tool result (`TOOL_CALL_RESULT`) in the `chat()` stream and emits an `ACTIVITY_SNAPSHOT` event with `activityType: 'a2ui-surface'` carrying the A2UI operations. Use `@ag-ui/core` event types so the output is type-safe. (Alternative native paths noted in SETUP.md §5: `ctx.emitCustomEvent` and `ActivityPart` — the transform remains the simplest fit for the CopilotKit convention.)
- **Deliverable:** Snapshot mapping module (or documented verification that it's unnecessary).
- **Automated tests:** `server/src/a2ui-snapshot.test.ts` — with the mock adapter from Step 7: (a) a scripted tool-call run yields an `ACTIVITY_SNAPSHOT` containing the A2UI ops; (b) a run without tool calls passes through unchanged; (c) every emitted event passes `@ag-ui/core` validation.
- **Verify:** `pnpm --filter server test` passes.

### Step 8: AG-UI `/chat` endpoint (SSE)
- **Do:** `server/src/chat-route.ts` — `POST /chat` accepting AG-UI `RunAgentInput`, running the TanStack `chat()` stream (Step 7) through the snapshot mapping (Step 8a) and returning it as an SSE response (TanStack's `toServerSentEventsResponse` or equivalent — verify exact API against installed docs). Wire into `index.ts` with CORS for `http://localhost:4200` (env-overridable). On agent failure, emit an AG-UI `RUN_ERROR` event instead of an HTTP 500 mid-stream.
- **Deliverable:** Streaming AG-UI endpoint.
- **Automated tests:** `server/src/chat-route.test.ts` — build the app with the **mock adapter** injected (factory from Step 7): (a) POST a minimal `RunAgentInput` → response is `text/event-stream`; (b) parse the SSE frames and assert the event sequence contains `RUN_STARTED`, `TOOL_CALL_START` (name `generate_ui`), `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `ACTIVITY_SNAPSHOT`, `TEXT_MESSAGE_*`, `RUN_FINISHED` in order; (c) malformed body (missing `messages`) → 400 before the stream starts.
- **Verify:** `pnpm --filter server test` passes; manual `curl -N -X POST localhost:8787/chat -d '{...}'` shows streaming frames.

### Step 9: Server contract test against real AG-UI types
- **Do:** Add a test that validates the emitted SSE events against the actual `@ag-ui/core` event schemas (import the zod/event validators from `@ag-ui/core` if exported; otherwise parse with their TS types + minimal runtime checks). This pins our `ACTIVITY_SNAPSHOT`/`a2ui-surface` convention in code (SETUP.md §2.3).
- **Deliverable:** Contract test module.
- **Automated tests:** `server/src/agui-contract.test.ts` — run the Step 8 stream (mock adapter) and assert every emitted event passes the AG-UI event validation, and that the A2UI ops inside the snapshot match the Step 5 schema.
- **Verify:** `pnpm --filter server test` passes.

---

## Phase 2 — Client core (CopilotKit + A2UI rendering)

### Step 10: CopilotKit wiring + chat panel
- **Do:** `client/src/app/app.config.ts` — `provideCopilotKit({ agents: { uiAgent: new HttpAgent({ url: 'http://localhost:8787/chat' }) } })` (URL from an environment/config file). Render `<copilot-chat agentId="uiAgent" />` in the app component inside a simple two-pane layout.
- **Deliverable:** Chat that talks to the server.
- **Automated tests:** `app.component.spec.ts` — component renders the chat element; config provider supplies an agent named `uiAgent`. (Live streaming is verified manually in Step 14.)
- **Verify:** `pnpm --filter client test -- --watch=false` passes; with server running, sending a message in the browser shows a streamed text response (manual smoke).

### Step 11: A2UI renderer configuration (Basic Catalog)
- **Do:** `client/src/app/a2ui/catalog.ts` — register `@a2ui/angular` renderer: `A2UI_RENDERER_CONFIG` provider with `BasicCatalog`, expose `A2uiRendererService` + `SurfaceComponent` setup. Install `@a2ui/angular` + `@a2ui/web_core` (versions pinned from Step 1).
- **Deliverable:** Renderer config module.
- **Automated tests:** `client/src/app/a2ui/catalog.spec.ts` — a test component using the surface renders a **hardcoded static A2UI document** (e.g. a Column with a Text and a Button) without errors; assert the rendered DOM contains the expected text.
- **Verify:** `pnpm --filter client test -- --watch=false` passes.

### Step 12: Activity renderer (`a2ui-surface` → A2UI)
- **Do:** `client/src/app/a2ui/activity-renderer.component.ts` — CopilotKit activity renderer registered for `activityType: 'a2ui-surface'`: extracts A2UI operations from `ACTIVITY_SNAPSHOT` content and feeds them to `A2uiRendererService`. Wire A2UI Actions (button clicks etc.) to post a new user message back to the agent.
- **Deliverable:** Activity renderer component.
- **Automated tests:** `activity-renderer.spec.ts` — (a) given a mock snapshot with valid ops, the component renders the corresponding components (DOM assertions); (b) given an invalid/unknown activityType, it renders nothing and logs a warning; (c) clicking a rendered Button emits the expected action payload (spy on the message-posting service).
- **Verify:** `pnpm --filter client test -- --watch=false` passes.

### Step 13: Material app shell
- **Do:** `app.component.*` — Material shell per SETUP.md §7.3: `mat-toolbar` ("Prompt CMS"), two-pane layout (chat left, generated-UI surface right), basic theming/responsive split. No business logic — pure presentation.
- **Deliverable:** Styled shell.
- **Automated tests:** Update `app.component.spec.ts` — toolbar renders title; both panes exist; layout classes applied.
- **Verify:** `pnpm --filter client test -- --watch=false` passes; visual check via `pnpm --filter client start`.

---

## Phase 3 — Integration & hardening

### Step 14: End-to-end smoke (manual, real model)
- **Do:** With `OPENROUTER_API_KEY` set (never committed; `.env` gitignored), run server + client. Prompt: *"Build me a dashboard for server metrics"*. Confirm: streamed chat text, generated UI appears in the right pane, a follow-up prompt updates the UI, and a button click in the generated UI round-trips to the agent.
- **Prompt iteration:** This step is also where the system prompt (`agent-prompt.ts`) gets tuned against the real model — if the model produces invalid A2UI, missing components, or overly large surfaces, refine the schema summary and few-shot examples in the prompt and re-run. Record what worked in the prompt module.
- **Deliverable:** Working end-to-end POC.
- **Testable result:** The full message-flow walkthrough from SETUP.md §3 is observed in the browser. Record the observed event sequence (browser devtools → network → SSE) and paste it into `SETUP.md` §3 as a validation note.
- **Note:** This step is manual by design — it validates the real-model path that mock tests can't cover.

### Step 15: Automated end-to-end test (server-side, real protocol)
- **Do:** Add an integration test that boots the real Hono app (mock adapter) and drives it exactly like the Angular client does — using `@ag-ui/client`'s `HttpAgent` pointed at the in-process server (or a `node:http` listener on an ephemeral port). Assert the client-side event stream matches the server contract.
- **Deliverable:** Client-protocol-level integration test.
- **Automated tests:** `server/src/e2e-agui.test.ts` — `HttpAgent.runAgent()` completes; subscriber receives the full expected event sequence; no `RUN_ERROR`.
- **Verify:** `pnpm --filter server test` passes (this closes the loop: the same code path the browser uses is now under automated test).

### Step 16: Polish + documentation
- **Do:** Root `README.md` (run instructions from SETUP.md §9, env vars from §8, test commands per workspace). Update `SETUP.md` status from "Plan" to "Implemented (POC)". Clean up TODOs, ensure all tests green in both workspaces, commit.
- **Deliverable:** Final POC state.
- **Testable result:** `pnpm --filter server test` and `pnpm --filter client test -- --watch=false` both pass; `git status` clean after commit.

---

## Dependency graph

```
Step 1 ─► Step 2 ─► Step 3 ─┐
                └─► Step 4 ─┤
                            ├─► Step 10 ─► Step 13 ─┐
        Step 5 ─► Step 6 ─► Step 7 ─► Step 8a ─► Step 8 ─► Step 9 ─┤
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
| 1 | Schema, tool, agent (mock adapter), snapshot mapping, SSE route, AG-UI contract tests | `curl` SSE stream |
| 2 | Component tests (catalog, activity renderer, shell) | Browser chat smoke |
| 3 | `HttpAgent` end-to-end integration test | Real-model E2E walkthrough |
