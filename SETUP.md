# SETUP.md — POC: AI Agent that Builds Web UI on the Fly

> **Status:** Plan / feasibility-validated (research date: Nov 2026)
> **Goal:** A user types a prompt; an AI agent generates a rich, interactive web UI
> that streams into an Angular client and renders progressively.

---

## 1. Architecture Overview

```
┌─────────────────────────────┐         SSE (AG-UI events)        ┌──────────────────────────────────┐
│  Angular Client             │ ◄──────────────────────────────── │  Node.js Server (Hono)           │
│                             │         POST /chat                │                                  │
│  CopilotKit Angular         │ ────────────────────────────────► │  ┌────────────────────────────┐  │
│  (@copilotkit/angular)      │         RunAgentInput             │  │  TanStack AI               │  │
│                             │                                   │  │  (@tanstack/ai, chat())    │  │
│  A2UI Renderer              │                                   │  └─────────┬──────────────────┘  │
│  (@a2ui/angular,            │                                   │            │                     │
│   Basic Catalog)            │                                   │  ┌─────────▼──────────────────┐  │
│                             │                                   │  │  @tanstack/                │  │
│  AG-UI HttpAgent            │                                   │  │  ai-openrouter             │  │
│  (@ag-ui/client)            │                                   │  └─────────┬──────────────────┘  │
│                             │                                   │            │                     │
│  Material shell (static)    │                                   │  ┌─────────▼──────────────────┐  │
└─────────────────────────────┘                                   │  │  OpenRouter LLM API        │  │
                                                                  │  └────────────────────────────┘  │
                                                                  │                                  │
                                                                  │  Tools (Zod):                    │
                                                                  │   - generate_ui (A2UI ops)       │
                                                                  │   - validate + retry on error    │
                                                                  └──────────────────────────────────┘
```

**Protocol layering:**

| Layer | Protocol | Role |
|---|---|---|
| Transport | **AG-UI** (HTTP + SSE) | Carries streaming agent events (`TEXT_MESSAGE_*`, `TOOL_CALL_*`, `ACTIVITY_SNAPSHOT`, `RUN_*`) between server and client |
| UI payload | **A2UI** (declarative JSON) | Describes *what* to render — components, structure, data bindings |
| Agent runtime | **TanStack AI** (`@tanstack/ai`) | Agent loop, tool dispatch, streaming — **emits AG-UI events natively** (imported from `@ag-ui/core`) |
| Model access | **OpenRouter** via `@tanstack/ai-openrouter` | Multi-model access through one API (official TanStack/OpenRouter partnership) |

---

## 2. Stack Decisions (with rationale)

### 2.1 Server

| Component | Choice | Why |
|---|---|---|
| Runtime | **Node.js** (22+) | No platform lock-in; Hono runs natively |
| HTTP framework | **Hono** | Lightweight, TS-first, built-in `streamSSE` helper — proven pattern for AG-UI endpoints |
| Agent SDK | **TanStack AI** (`@tanstack/ai`, v1.1.0) | Selected over Vercel AI SDK, Mastra, `@openrouter/agent`, Google ADK-js, and Cloudflare Agents SDK. Decisive reasons: (a) **native AG-UI compliance in both directions** — server→client events are AG-UI events imported from `@ag-ui/core`, and client→server requests are AG-UI `RunAgentInput`; no bridge or adapter needed; (b) first-class OpenRouter adapter (`@tanstack/ai-openrouter`) backed by an official OpenRouter/TanStack partnership; (c) Zod-typed `toolDefinition()` tools; (d) runs on plain Node.js + Hono (explicitly supported); (e) MIT license. Caveat: young — 1.0 shipped Oct 2026, volunteer maintainers |
| Model access | **`@tanstack/ai-openrouter`** | First-class OpenRouter adapter: 300+ models, provider ordering, fallbacks, model variants |
| AG-UI bridge | **None needed** | TanStack AI's wire protocol *is* AG-UI (both directions). Any AG-UI client (our CopilotKit Angular client) can call a `@tanstack/ai` endpoint unmodified. Only a tiny mapping of the `generate_ui` tool result → `ACTIVITY_SNAPSHOT` (`a2ui-surface`) may be needed — verify at install time whether current versions emit it natively |
| Schema validation | **Zod** | Tool input/output schemas, `RunAgentInput` parsing, A2UI operation validation |
| UI payload | **A2UI** (`@a2ui/web_core` server-side validation) | Declarative, LLM-friendly, streaming-first; safe (no arbitrary code execution on client) |

**Alternatives considered and rejected:**

- **Vercel AI SDK** (`ai` v7) — most mature (~18M weekly downloads), official `@openrouter/ai-sdk-provider`, but **no AG-UI adapter exists** (`@ag-ui/vercel-ai-sdk` is an unmerged roadmap item, ag-ui issue #933 / PR #1626) — would require a custom ~100–200 line bridge. Runner-up.
- Mastra — published `@ag-ui/mastra@2.0.2` adapter, Hono-native server, but heavier framework than needed for a POC. **Documented fallback** if TanStack AI proves too immature.
- Google ADK-js — now has a published `@ag-ui/adk-js` integration (Oct 2026), but Gemini-first; OpenRouter only via OpenAI-compatible workaround. Poor fit for our OpenRouter requirement.
- `@openrouter/agent` — TS + OpenRouter + Zod native, but no AG-UI adapter; young (v0.11).
- OpenAI Agents SDK (Python) — contradicts the TypeScript requirement.
- Cloudflare Agents SDK — excellent (durable memory, community AG-UI integration), but **requires Cloudflare Workers/Durable Objects** as deployment platform; rejected to stay on plain Node.js.

### 2.2 Client

| Component | Choice | Why |
|---|---|---|
| Framework | **Angular** | Team expertise |
| AG-UI layer | **CopilotKit** (`@copilotkit/angular`) | Chat UI, agent store, and activity-renderer plumbing for free; reference implementation for the A2UI-over-AG-UI pattern. Speaks AG-UI natively via `HttpAgent` |
| A2UI renderer | **`@a2ui/angular`** (on `@a2ui/web_core`) | Official Angular adapter; `A2uiRendererService`, `SurfaceComponent`, `BasicCatalog` |
| Component catalog | **A2UI Basic Catalog** (POC) | Fastest path to a working POC. The Basic Catalog renders its own components — **not** Angular Material. A custom Material catalog (mapping A2UI components → Angular Material) is a post-POC effort |
| Material Design | Static app shell only (layout, chrome, chat styling) | See note above |

### 2.3 Key architectural insight (most important)

**There is no formal spec for transmitting A2UI over AG-UI.** The de-facto standard
(used by CopilotKit, whose makers co-created AG-UI) is:

1. The LLM emits A2UI operations as **tool-call arguments** (tool: `generate_ui`).
2. A **server-side tool** validates the operations with Zod against the A2UI schema.
   Validation errors are fed back to the model for retry — **only valid structures
   reach the client**. Never let the LLM emit raw UI JSON straight to the browser.
3. Valid operations travel inside an AG-UI **`ACTIVITY_SNAPSHOT`** message with
   `activityType: 'a2ui-surface'`.
4. On the client, an **activity renderer** component receives the operations and
   hands them to `A2uiRendererService`, which renders them via the Basic Catalog.

**Streaming:** TanStack AI streams AG-UI events as they are produced — text deltas
(`TEXT_MESSAGE_CONTENT`) and tool-call arguments (`TOOL_CALL_ARGS`) stream into the
browser progressively, so A2UI structures can render as they are generated rather
than arriving in one chunk at the end. (Whether tool-argument *token-level* streaming
is available for OpenRouter models — e.g. Anthropic's fine-grained tool streaming —
is a Step 1 verification item.)

---

## 3. Message Flow Walkthrough

```
User prompt ("Build me a dashboard for server metrics")
  │
  ▼
Angular: CopilotKit sends POST /chat (RunAgentInput: threadId, runId, messages)
  │
  ▼
Hono route handler → TanStack AI `chat()` runs the agent loop
  │
  ▼
AI SDK Agent loop:
  1. LLM decides to call tool `generate_ui` with A2UI operations as arguments
     (streamed token-by-token with fine-grained tool streaming)
  2. Tool execute(): Zod-validate ops against A2UI schema
     ├─ invalid → return error → LLM retries (loop continues)
     └─ valid   → return success
  3. LLM produces final text summary
  │
  ▼
TanStack AI emits AG-UI events natively (imported from `@ag-ui/core`):
  RUN_STARTED → TOOL_CALL_START → TOOL_CALL_ARGS (streaming) → TOOL_CALL_END
  → ACTIVITY_SNAPSHOT (a2ui-surface ops, via tool-result mapping) → TEXT_MESSAGE_* → RUN_FINISHED
  │
  ▼
Hono streamSSE writes each event as an SSE frame
  │
  ▼
Angular: HttpAgent/CopilotKit receives events
  ├─ TEXT_MESSAGE_*  → chat window (streaming text)
  └─ ACTIVITY_SNAPSHOT → activity renderer → A2uiRendererService
                          → Basic Catalog renders the UI progressively
  │
  ▼
User interacts with generated UI (buttons, forms, inputs)
  → A2UI Action fires → posted back to /chat as a new user message
  → agent loop repeats (follow-up UI updates stream back)
```

---

## 4. Project Structure

```
prompt-cms/
├── SETUP.md
├── package.json                  # pnpm workspaces (+ pnpm-workspace.yaml)
├── server/
│   ├── package.json
│   └── src/
│       ├── index.ts              # Hono app, CORS, /chat route
│       ├── agent.ts              # TanStack AI chat() setup (adapter, instructions, tools)
│       ├── agent-prompt.ts       # System prompt builder (tool contract, schema summary, examples)
│       ├── tools/
│       │   └── generate-ui.ts    # Zod-validated A2UI generation tool (toolDefinition)
│       ├── a2ui-snapshot.ts      # generate_ui tool result → ACTIVITY_SNAPSHOT mapping
│       └── chat-route.ts         # /chat route + SSE response glue
└── client/
    ├── package.json
    └── src/
        ├── app/
        │   ├── app.config.ts     # provideCopilotKit, A2UI_RENDERER_CONFIG
        │   ├── app.component.*   # Material shell + chat + surface area
        │   └── a2ui/
        │       ├── activity-renderer.component.ts  # ACTIVITY_SNAPSHOT → A2UI
        │       └── catalog.ts    # BasicCatalog registration
        └── main.ts
```

---

## 5. Packages & Versions

### Step 0 — Version alignment check (DONE — 2026-11-05)

Executed results:

- **TanStack AI (chosen):**
  - `@tanstack/ai@1.1.0` — stable 1.0 line (1.0 shipped Oct 2026); peer: `@opentelemetry/api >= 1.9.0`
  - `@tanstack/ai-openrouter@1.1.0` — peers on `@tanstack/ai@^1.1.0` ✅ compatible
  - `@tanstack/ai-angular@1.0.1` — peers on `@tanstack/ai@^1.0.1`, `@angular/core >= 21.0.0` ✅ compatible
  - **AG-UI compliance (verified against `@tanstack/ai@1.1.0` dist, 2026-11-05):**
    - ✅ Event types are **imported directly from `@ag-ui/core`** (`ActivitySnapshotEvent`, `RunStartedEvent`, `ToolCallResultEvent`, …) — full native AG-UI type compliance.
    - ✅ `ACTIVITY_SNAPSHOT` is a first-class event type (spec keys: `messageId`, `activityType`, `content`, `replace` — exactly AG-UI 1.0); the client-side stream processor handles it.
    - ⚠️ **Server-side `chat()` does NOT auto-emit `ACTIVITY_SNAPSHOT` for tool results** — `buildToolResultChunks()` emits `TOOL_CALL_RESULT` (with `TOOL_CALL_START/ARGS/END` fan-out). → The small `a2ui-snapshot.ts` mapping (PLAN Step 8a) **is required**: intercept the `generate_ui` tool result and emit `ACTIVITY_SNAPSHOT` with `activityType: 'a2ui-surface'`.
    - ℹ️ Alternative native paths noted: tools get `ctx.emitCustomEvent(name, value)` (emits AG-UI `CUSTOM` events), and TanStack has a first-class `ActivityPart` (`type: 'activity'`, `activityType` + `content`) that serializes into AG-UI `ActivityMessage` wire rows. The `TOOL_CALL_RESULT` → `ACTIVITY_SNAPSHOT` transform remains the simplest fit for the CopilotKit convention.
    - ℹ️ `@tanstack/ai` ships a `testing/` directory (e.g. `fake-text.js`) — useful for the Step 7 mock-adapter tests.
- **AG-UI packages:** `@ag-ui/core@1.0.3`, `@ag-ui/client@1.0.3`, `@ag-ui/mastra@2.0.2`, `@ag-ui/langgraph`, `@ag-ui/llamaindex`, `@ag-ui/crewai`, etc.
- **Evaluated alternatives:** `@openrouter/ai-sdk-provider@3.1.0` (v7-only, but no AG-UI adapter exists — `@ag-ui/vercel-ai-sdk` is an unmerged roadmap item, ag-ui issue #933 / PR #1626).

**Consequence:** TanStack AI is the primary choice — no AG-UI bridge needed.
Fallback: Mastra (published `@ag-ui/mastra@2.0.2` adapter) if TanStack AI proves
too immature during the POC.

### Server

```bash
pnpm add @tanstack/ai @tanstack/ai-openrouter @ag-ui/core zod hono @hono/node-server
```

| Package | Purpose |
|---|---|
| `@tanstack/ai` | Core: `chat()`, streaming, tool system, agent loop strategies |
| `@tanstack/ai-openrouter` | OpenRouter adapter (`openRouterText`, provider ordering/fallbacks) |
| `@ag-ui/core` | AG-UI event types (TanStack emits these natively; used for snapshot mapping + contract tests) |
| `zod` | Tool schemas + A2UI validation |
| `hono` + `@hono/node-server` | HTTP server + SSE response glue |

### Client

```bash
pnpm add @copilotkit/angular @ag-ui/client @a2ui/angular @a2ui/web_core @angular/material @angular/cdk
```

| Package | Purpose |
|---|---|
| `@copilotkit/angular` | Chat UI, agent store, activity-renderer plumbing |
| `@ag-ui/client` | `HttpAgent` (AG-UI transport client) |
| `@a2ui/angular` + `@a2ui/web_core` | A2UI renderer + Angular adapter (v0.9) |
| `@angular/material` + `@angular/cdk` | Static app shell styling |

---

## 6. Server Implementation Sketch

### 6.1 Agent setup (`server/src/agent.ts` + `server/src/agent-prompt.ts`)

The system prompt is a **first-class artifact** — the LLM must be told the A2UI
message structure, the available Basic Catalog components, and shown example
surfaces, or it cannot produce valid output. It lives in its own module so it
can be iterated on independently (see Step 14 real-model E2E).

```typescript
// server/src/agent-prompt.ts
import { a2uiPromptSummary } from './a2ui/schema.js'; // compact schema summary from Step 5

export function buildSystemPrompt(): string {
  return [
    'You are a UI generation assistant.',
    'When the user asks for an interface, dashboard, or form, generate it by',
    'calling the generate_ui tool with A2UI operations.',
    '',
    '## A2UI message structure',
    'Emit beginRendering, updateComponents, and updateDataModel messages.',
    a2uiPromptSummary, // component schema summary (Text, Row, Column, Button, TextInput, ...)
    '',
    '## Example surface',
    EXAMPLE_SURFACE_JSON, // 1-2 complete, valid A2UI documents (few-shot)
    '',
    '## Rules',
    '- Only use components from the catalog above.',
    '- Keep surfaces small; update existing surfaces instead of recreating them.',
  ].join('\n');
}
```

```typescript
// server/src/agent.ts
import { chat } from '@tanstack/ai';
import { openRouterText } from '@tanstack/ai-openrouter';
import { generateUiTool } from './tools/generate-ui.js';
import { buildSystemPrompt } from './agent-prompt.js';

export function runUiAgent(messages, threadId) {
  return chat({
    adapter: openRouterText(process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4.5'),
    systemPrompts: [buildSystemPrompt()], // TanStack: system text goes here (no system role in ModelMessage)
    messages,
    threadId,
    tools: [generateUiTool],
    // agent loop strategy: keep calling tools until none are requested
    maxSteps: 10, // loop guard
  });
}
```

The adapter reads `OPENROUTER_API_KEY` from the environment. Model choice,
provider ordering, and fallbacks are configured via `modelOptions` on the
adapter call (see `@tanstack/ai-openrouter` docs).

### 6.2 A2UI validation tool (`server/src/tools/generate-ui.ts`)

```typescript
import { toolDefinition } from '@tanstack/ai';
import { z } from 'zod';
// A2UI operation schema — mirror the A2UI v0.9 spec (surface, components, data bindings)
import { a2uiOperationsSchema } from '../a2ui/schema.js';

export const generateUiTool = toolDefinition({
  name: 'generate_ui',
  description: 'Generate or update a user interface using A2UI operations',
  inputSchema: a2uiOperationsSchema, // Zod schema of A2UI ops
  // TanStack isomorphic tools: run on the server
}).server(async (operations) => {
  // Validated by Zod before the handler runs.
  // Return the ops so they can be emitted as ACTIVITY_SNAPSHOT.
  return { status: 'ok', operations };
});
```

On invalid tool arguments the AI SDK surfaces a validation error to the model,
which retries — invalid UI structures never reach the client.

### 6.3 AG-UI endpoint (`server/src/chat-route.ts` + `index.ts`)

```typescript
import { Hono } from 'hono';
import { toServerSentEventsResponse } from '@tanstack/ai';
import { runUiAgent } from './agent.js';
import { toA2uiSnapshot } from './a2ui-snapshot.js';

const app = new Hono();

app.post('/chat', async (c) => {
  const input = await c.req.json(); // AG-UI RunAgentInput
  // chat() emits AG-UI events natively; toServerSentEventsResponse wraps
  // the stream as an SSE Response. toA2uiSnapshot maps generate_ui tool
  // results to ACTIVITY_SNAPSHOT (activityType: 'a2ui-surface') events.
  const stream = runUiAgent(input.messages, input.threadId)
    .pipeThrough(toA2uiSnapshot());
  return toServerSentEventsResponse(stream);
});

export default app; // served via @hono/node-server
```

CORS: restrict to the Angular dev-server origin (e.g. `http://localhost:4200`);
`origin: '*'` only for local POC.

> **Note:** the exact composition API (`toServerSentEventsResponse`, stream
> transform shape) must be verified against the installed `@tanstack/ai@1.1.0`
> docs at implementation time — the sketch reflects the documented 1.0 patterns.

---

## 7. Client Implementation Sketch

### 7.1 App configuration (`client/src/app/app.config.ts`)

```typescript
import { provideCopilotKit } from '@copilotkit/angular';
import { HttpAgent } from '@ag-ui/client';
import { A2UI_RENDERER_CONFIG, BasicCatalog } from './a2ui/catalog';

export const appConfig: ApplicationConfig = {
  providers: [
    provideCopilotKit({
      agents: {
        uiAgent: new HttpAgent({ url: 'http://localhost:8787/chat' }),
      },
    }),
    {
      provide: A2UI_RENDERER_CONFIG,
      useValue: { catalog: BasicCatalog /* + component mappings */ },
    },
  ],
};
```

### 7.2 Activity renderer (`client/src/app/a2ui/activity-renderer.component.ts`)

A CopilotKit activity renderer registered for `activityType: 'a2ui-surface'`:
it receives the A2UI operations from `ACTIVITY_SNAPSHOT` and feeds them to
`A2uiRendererService`, which renders via `SurfaceComponent` + Basic Catalog.
User interactions (A2UI Actions) are posted back to the agent as new messages.

### 7.3 App shell (`app.component.html`)

```html
<!-- Material-styled static shell -->
<mat-toolbar>Prompt CMS</mat-toolbar>
<div class="layout">
  <copilot-chat agentId="uiAgent" />   <!-- chat panel -->
  <a2ui-surface />                     <!-- generated UI area -->
</div>
```

---

## 8. Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | server | OpenRouter API access |
| `OPENROUTER_MODEL` (optional) | server | Model override (e.g. `anthropic/claude-sonnet-4.5`) |

Never commit credentials; use `.env` (gitignored) or injected secrets.

---

## 9. Run Instructions (once implemented)

```bash
# Terminal 1 — server
pnpm --filter server dev         # Hono on http://localhost:8787

# Terminal 2 — client
pnpm --filter client start       # Angular dev server on http://localhost:4200
```

---

## 10. Known Risks & POC Scope Boundaries

| Risk | Mitigation |
|---|---|
| **LLM output quality depends heavily on prompt quality** (A2UI structure + catalog knowledge must reach the model) | System prompt is a dedicated module (`agent-prompt.ts`): tool contract + schema summary + few-shot example surfaces; iterate on it during the Step 14 real-model E2E |
| **TanStack AI youth** — 1.0 shipped Oct 2026, ~553k weekly downloads, volunteer maintainers; API churn possible | Pin exact versions in lockfile; keep TanStack usage isolated in `agent.ts` + `chat-route.ts`; Mastra (`@ag-ui/mastra@2.0.2`) is the documented fallback |
| **`ACTIVITY_SNAPSHOT` support unverified** — older TanStack 0.x docs list `CUSTOM` events but not `ACTIVITY_SNAPSHOT` (AG-UI 1.0 event) | Step 1 verification item: check whether `@tanstack/ai@1.1.0` emits it natively; if not, map the `generate_ui` tool result ourselves in `a2ui-snapshot.ts` (tiny module) |
| **A2UI maturity** — v0.9 is "early stage public preview"; v1.0 spec is a release candidate; expect churn | Pin versions; isolate A2UI schema in one server module; isolate renderer config in one client module |
| **A2UI-over-AG-UI convention is not formally standardized** (`ACTIVITY_SNAPSHOT` + `activityType: 'a2ui-surface'` is the de-facto CopilotKit pattern) | Follow the CopilotKit/angular-architects reference implementation; document our convention in code |
| **Basic Catalog ≠ Material look** | Accept for POC; custom Material catalog is a post-POC workstream |
| **LLM generating invalid A2UI** | Server-side Zod validation + model retry loop (built into the tool design) |
| **Prompt-injection via generated UI** | A2UI is declarative — no arbitrary code execution on client by design; actions are allow-listed |

**Explicitly out of POC scope:** persistence (in-memory conversation state only),
authentication, custom Material catalog, multi-agent orchestration, production
deployment.

---

## 11. Reference Material

- angular-architects series *"Agentic UI with Angular"* (10 parts, 2026) — the closest
  end-to-end reference for this exact stack:
  - A2UI in Angular: https://www.angulararchitects.io/en/blog/a2ui-how-ai-generates-dynamic-uis-at-runtime/
  - A2UI + AG-UI integration: https://www.angulararchitects.io/en/blog/integrating-a2ui-with-ag-ui-in-angular/
  - AG-UI end-to-end (server + client): https://www.angulararchitects.io/en/blog/ag-ui-in-practice-ag-ui-end-to-end-connecting-server-and-client/
- A2UI: https://github.com/a2ui-project/a2ui · https://a2ui.org
- AG-UI: https://github.com/ag-ui-protocol/ag-ui · https://docs.ag-ui.com
- TanStack AI (chosen): https://tanstack.com/ai/latest · https://github.com/TanStack/ai
  - OpenRouter adapter: https://tanstack.com/ai/latest/docs/adapters/openrouter
  - AG-UI compliance: https://tanstack.com/blog/ag-ui-compliance
  - Angular package: https://tanstack.com/ai/latest/docs/api/ai-angular
- Vercel AI SDK (evaluated alternative): https://ai-sdk.dev · https://github.com/OpenRouterTeam/ai-sdk-provider
- Mastra (documented fallback): https://mastra.ai · AG-UI adapter: `@ag-ui/mastra`
- Google ADK-js (evaluated alternative): https://github.com/google/adk-js · AG-UI quickstart: https://docs.ag-ui.com/integrations/google-adk-js
- OpenRouter Agent SDK (evaluated alternative): https://openrouter.ai/docs/agent-sdk/overview
- CopilotKit Angular + A2UI docs: https://docs.copilotkit.ai/generative-ui/a2ui
- Cloudflare Agents SDK (evaluated alternative): https://developers.cloudflare.com/agents/
