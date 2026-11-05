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
| Agent SDK | **TanStack AI** (`@tanstack/ai`, v1.2.0) | Selected over Vercel AI SDK, Mastra, `@openrouter/agent`, Google ADK-js, and Cloudflare Agents SDK. Decisive reasons: (a) **native AG-UI compliance in both directions** — server→client events are AG-UI events imported from `@ag-ui/core`, and client→server requests are AG-UI `RunAgentInput`; no bridge or adapter needed; (b) first-class OpenRouter adapter (`@tanstack/ai-openrouter`) backed by an official OpenRouter/TanStack partnership; (c) Zod-typed `toolDefinition()` tools; (d) runs on plain Node.js + Hono (explicitly supported); (e) MIT license. Caveat: young — 1.0 shipped Oct 2026, volunteer maintainers; ships bundled agent skills (`skills/ai-core/*/SKILL.md`) as first-party API docs |
| Model access | **`@tanstack/ai-openrouter`** | First-class OpenRouter adapter: 300+ models, provider ordering, fallbacks, model variants |
| AG-UI bridge | **None needed** | TanStack AI's wire protocol *is* AG-UI (both directions). Any AG-UI client (our CopilotKit Angular client) can call a `@tanstack/ai` endpoint unmodified. Only a tiny mapping of the `generate_ui` tool result → `ACTIVITY_SNAPSHOT` (`a2ui-surface`) may be needed — verify at install time whether current versions emit it natively |
| Schema validation | **Zod** (v4, TanStack-facing) + **`@a2ui/agent`** (A2UI validation) | Zod for tool envelope + `RunAgentInput`; A2UI payload validation delegated to the official SDK (spec-exact, maintained by the A2UI team) |
| UI payload | **A2UI** via **`@a2ui/agent`** (`validatePayload` + `promptSnippet`) | Declarative, LLM-friendly, streaming-first; safe (no arbitrary code execution on client). Validation, prompt content, and catalog handling come from the official SDK — no hand-mirrored schema to maintain |

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
2. A **server-side tool** validates the operations with the official **`@a2ui/agent`**
   SDK (`validatePayload(catalogs, messages)` — spec-exact, the same validation the
   Angular renderer's `@a2ui/web_core` schemas are generated from). Validation
   errors are fed back to the model for retry — **only valid structures reach the
   client**. Never let the LLM emit raw UI JSON straight to the browser.
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
│       ├── main.ts               # @hono/node-server entry (port 8787)
│       ├── index.ts              # createApp() factory + /health (tests inject a mock adapter)
│       ├── agent.ts              # runUiAgent(): TanStack chat() + injectable adapter + loop guard
│       ├── agent-prompt.ts       # System prompt builder (tool contract + SDK promptSnippet + guardrails)
│       ├── tools/
│       │   └── generate-ui.ts    # generate_ui tool (thin Zod envelope; validation via @a2ui/agent)
│       ├── a2ui/
│       │   ├── index.ts          # Thin wrapper: catalog loading, validateA2uiPayload(), getPromptSnippet()
│       │   └── spec/             # Vendored official spec fixtures (catalog.json, example-login-form.json)
│       ├── a2ui-snapshot.ts      # generate_ui tool result → ACTIVITY_SNAPSHOT mapping
│       ├── chat-route.ts         # /chat route: RunAgentInput validation + SSE + RUN_ERROR handling
│       └── test-fixtures.ts      # Shared minimal-valid-A2UI-operations fixture for tests
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
  - `@tanstack/ai@1.2.0` — stable 1.0 line (1.0 shipped Oct 2026; 1.2.0 published 2026-11-05, **pinned exact** in `server/package.json`); peer: `@opentelemetry/api >= 1.9.0`
  - `@tanstack/ai-openrouter@1.1.1` — peers on `@tanstack/ai@^1.2.0` ✅ compatible (note: the adapter version lags the core — 1.1.x peers on 1.2.0)
  - `@tanstack/ai-angular@1.0.1` — peers on `@tanstack/ai@^1.0.1`, `@angular/core >= 21.0.0` ✅ compatible
  - **AG-UI compliance (verified against `@tanstack/ai` dist, 2026-11-05):**
    - ✅ Event types are **imported directly from `@ag-ui/core`** (`ActivitySnapshotEvent`, `RunStartedEvent`, `ToolCallResultEvent`, …) — full native AG-UI type compliance.
    - ✅ `ACTIVITY_SNAPSHOT` is a first-class event type (spec keys: `messageId`, `activityType`, `content`, `replace` — exactly AG-UI 1.0); the client-side stream processor handles it.
    - ⚠️ **Server-side `chat()` does NOT auto-emit `ACTIVITY_SNAPSHOT` for tool results** — `buildToolResultChunks()` emits `TOOL_CALL_RESULT` (with `TOOL_CALL_START/ARGS/END` fan-out). → The small `a2ui-snapshot.ts` mapping (part of PLAN Step 8) **is required**: intercept the `generate_ui` tool result and emit `ACTIVITY_SNAPSHOT` with `activityType: 'a2ui-surface'`.
    - ℹ️ Alternative native paths noted: tools get `ctx.emitCustomEvent(name, value)` (emits AG-UI `CUSTOM` events), and TanStack has a first-class `ActivityPart` (`type: 'activity'`, `activityType` + `content`) that serializes into AG-UI `ActivityMessage` wire rows. The `TOOL_CALL_RESULT` → `ACTIVITY_SNAPSHOT` transform remains the simplest fit for the CopilotKit convention.
    - ℹ️ `@tanstack/ai` ships a `testing/` directory (e.g. `fake-text.js`) — useful for the Step 7 mock-adapter tests.
- **AG-UI packages:** `@ag-ui/core@1.0.0` (**pinned exact** — `@tanstack/ai@1.2.0` depends on it exactly, so the direct server dependency dedupes to a single instance), `@ag-ui/client@1.0.3`, `@ag-ui/mastra@2.0.2`, `@ag-ui/langgraph`, `@ag-ui/llamaindex`, `@ag-ui/crewai`, etc.
- **Evaluated alternatives:** `@openrouter/ai-sdk-provider@3.1.0` (v7-only, but no AG-UI adapter exists — `@ag-ui/vercel-ai-sdk` is an unmerged roadmap item, ag-ui issue #933 / PR #1626).
- **A2UI agent SDK (chosen for A2UI validation + prompt content):**
  - `@a2ui/agent@0.1.0` — published 2026-11-02; deps: `@a2ui/web_core@^0.15.0` + `antlr4`. No peer dependencies.
  - Official SDK used by the A2UI team's own samples (e.g. `restaurant_finder`): catalog loaded from the **spec JSON** (`CatalogConfig.fromPath`), prompt content generated from the catalog (`processor.promptSnippet`), spec-exact validation (`validatePayload(catalogs, messages)` for one-shot tool-argument checks), and a built-in retry pattern (`retryQuery`).
  - Validation, prompt content, and catalog handling come from the official SDK (`@a2ui/agent`) — spec-exact by construction.
  - ⚠️ **Zod multi-install:** three copies in the lockfile — `zod@3.25.76` (`@a2ui/web_core` chain), `zod@4.6.7` (our server code), `zod@4.6.6` (`@modelcontextprotocol/*` chain, transitive via `@tanstack/ai`'s MCP support). pnpm isolates them — acceptable because the integration boundary is plain JSON (tool arguments), never Zod schema objects. Import-hygiene rule: never import Zod-typed values from the SDK/MCP chains into TanStack-facing code.

**Consequence:** TanStack AI is the primary choice — no AG-UI bridge needed.
Fallback: Mastra (published `@ag-ui/mastra@2.0.2` adapter) if TanStack AI proves
too immature during the POC.

### Server

```bash
pnpm add @tanstack/ai @tanstack/ai-openrouter @a2ui/agent @ag-ui/core@1.0.0 --save-exact zod hono @hono/node-server
```

| Package | Purpose |
|---|---|
| `@tanstack/ai` | Core: `chat()`, streaming, tool system, agent loop strategies |
| `@tanstack/ai-openrouter` | OpenRouter adapter (`openRouterText`, provider ordering/fallbacks) |
| `@a2ui/agent` | Official A2UI agent SDK: catalog loading (spec JSON), `validatePayload` (spec-exact validation), `promptSnippet` (prompt content) |
| `@ag-ui/core` | AG-UI event types (TanStack emits these natively; used for snapshot mapping + contract tests). **Pin `1.0.0` exact** — `@tanstack/ai@1.2.0` depends on `@ag-ui/core@1.0.0` exactly, so a direct dep at the same version dedupes to a single instance (a different version would create a second copy — same structural-typing hazard as the dual Zod) |
| `zod` | Tool envelope schemas + `RunAgentInput` parsing (Zod 4; the SDK chain brings its own Zod 3) |
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
import { getPromptSnippet } from './a2ui/index.js'; // SDK-generated prompt content (Step 5 wrapper)

export const UI_AGENT_TOOL_NAME = 'generate_ui';

export function buildSystemPrompt(): string {
  return [
    'You are a UI generation assistant.',
    `When the user asks for an interface, dashboard, or form, generate it by`,
    `calling the ${UI_AGENT_TOOL_NAME} tool with A2UI operations.`,
    '',
    '## A2UI format rules, catalog schemas, and examples',
    // DirectJsonPromptGenerator.generate() from @a2ui/agent — format rules,
    // component schemas, and examples generated from the loaded catalog.
    // Larger than a hand-written summary; the officially recommended trade-off.
    getPromptSnippet(),
    '',
    '## Rules',
    '- Only use components from the catalog above.',
    '- Keep surfaces small; update existing surfaces instead of recreating them.',
    '- After calling the tool, briefly summarize in text what you built or changed.',
  ].join('\n');
}
```

```typescript
// server/src/agent.ts
import { chat, maxIterations, type ModelMessage } from '@tanstack/ai';
import { openRouterText } from '@tanstack/ai-openrouter';
import { generateUi } from './tools/generate-ui.js';
import { buildSystemPrompt } from './agent-prompt.js';

export const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-sonnet-4.5';
export const MAX_AGENT_ITERATIONS = 10;

/** Any text adapter chat() accepts (real OpenRouter or the test fake). */
export type UiAgentAdapter = Parameters<typeof chat>[0]['adapter'];

export function runUiAgent(
  messages: Array<ModelMessage>,
  threadId: string,
  adapter?: UiAgentAdapter, // injectable — tests pass fakeText() from @tanstack/ai/testing
) {
  const model = (process.env.OPENROUTER_MODEL ??
    DEFAULT_OPENROUTER_MODEL) as typeof DEFAULT_OPENROUTER_MODEL;

  return chat({
    adapter: adapter ?? openRouterText(model),
    systemPrompts: [buildSystemPrompt()], // TanStack: system text goes here (no system role in ModelMessage)
    messages,
    threadId,
    tools: [generateUi],
    agentLoopStrategy: maxIterations(MAX_AGENT_ITERATIONS), // loop guard for the validate-and-retry cycle
  });
}
```

The adapter reads `OPENROUTER_API_KEY` from the environment. Model choice,
provider ordering, and fallbacks are configured via `modelOptions` on the
adapter call (see `@tanstack/ai-openrouter` docs).

### 6.2 `generate_ui` tool (`server/src/tools/generate-ui.ts` — implemented, see PLAN Step 6)

The tool keeps only a **minimal Zod envelope** — real, spec-exact validation
happens in the handler via the `@a2ui/agent` SDK. Invalid operations return a
structured error result (not a throw), so the model can retry within the agent
loop:

```typescript
import { toolDefinition } from '@tanstack/ai';
import { z } from 'zod';
import { validateA2uiPayload } from '../a2ui/index.js';

export const generateUiDef = toolDefinition({
  name: 'generate_ui',
  description:
    'Create or update a UI surface for the user by sending a list of A2UI ' +
    'protocol messages (createSurface, updateComponents, updateDataModel, ' +
    'deleteSurface). Follow the A2UI format rules, component catalog, and ' +
    'examples given in the system prompt…',
  inputSchema: z.object({
    operations: z.array(z.unknown()).meta({
      description: 'Ordered list of A2UI protocol messages (see system prompt)',
    }),
  }),
  outputSchema: z.discriminatedUnion('status', [
    z.object({ status: z.literal('ok'), operations: z.array(z.unknown()) }),
    z.object({ status: z.literal('error'), errorText: z.string() }),
  ]),
});

export const generateUi = generateUiDef.server(async ({ operations }) => {
  const result = validateA2uiPayload(operations);
  return result.ok
    ? { status: 'ok' as const, operations }
    : { status: 'error' as const, errorText: result.errorText };
});
```

> The A2UI format knowledge reaches the model through the system prompt
> (`getPromptSnippet()`), not through this schema. TanStack additionally
> validates tool results against `outputSchema` before sending them back to
> the model, and surfaces envelope-level input-validation failures to the
> model automatically.

### 6.2a A2UI wrapper (`server/src/a2ui/index.ts` — implemented, see PLAN Step 5)

```typescript
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CatalogConfig,
  DirectJsonPromptGenerator,
  validatePayload,
} from '@a2ui/agent';

const CATALOG_PATH = fileURLToPath(new URL('./spec/catalog.json', import.meta.url));

// The v0.9 catalog document does not state a protocol version — pass it explicitly.
const catalogConfig = CatalogConfig.fromPath(CATALOG_PATH, undefined, 'v0.9');
export const basicCatalog = catalogConfig.catalog;

export function validateA2uiPayload(operations: unknown) {
  try {
    validatePayload([basicCatalog], operations);
    return { ok: true } as const;
  } catch (error) {
    return {
      ok: false,
      errorText: error instanceof Error ? error.message : String(error),
    } as const;
  }
}

export function getPromptSnippet(): string {
  return new DirectJsonPromptGenerator([basicCatalog]).generate();
}
```

> Verified against the installed `@a2ui/agent@0.1.0`: `validatePayload` throws on
> invalid payloads; the loaded catalog exposes `components`/`functions` as Maps
> (18 / 14 entries) and `protocolVersion: 'v0.9'`; the message envelope carries
> `version` at the message level. Import hygiene: the SDK chain uses Zod 3 — the
> boundary here is plain JSON, never Zod schema objects.

### 6.3 AG-UI endpoint (`server/src/chat-route.ts` + `index.ts` — implemented, see PLAN Step 8)

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { RunAgentInputSchema } from '@ag-ui/core/schemas';
import { EventType, toServerSentEventsResponse, type StreamChunk } from '@tanstack/ai';
import { mapA2uiSnapshots } from './a2ui-snapshot.js';
import { runUiAgent, type UiAgentAdapter } from './agent.js';

export function registerChatRoute(app: Hono, options: { adapter?: UiAgentAdapter } = {}) {
  app.use('/chat', cors({ origin: 'http://localhost:4200', allowHeaders: ['Content-Type'] }));

  app.post('/chat', async (c) => {
    const parsed = RunAgentInputSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid RunAgentInput', issues: parsed.error.issues }, 400);

    // chat() emits AG-UI events natively; mapA2uiSnapshots appends an
    // ACTIVITY_SNAPSHOT (activityType: 'a2ui-surface') after each successful
    // generate_ui tool result. Synchronous agent failures (e.g. missing API
    // key) stream a RUN_ERROR frame in-band instead of an HTTP 500.
    let stream: AsyncIterable<StreamChunk>;
    try {
      stream = mapA2uiSnapshots(
        runUiAgent(toModelMessages(parsed.data.messages), parsed.data.threadId, options.adapter),
      ) as AsyncIterable<StreamChunk>;
    } catch (error) {
      stream = (async function* () {
        yield { type: EventType.RUN_ERROR, message: error instanceof Error ? error.message : 'Agent failed to start' };
      })();
    }
    return toServerSentEventsResponse(stream);
  });
}
```

CORS: restricted to the Angular dev-server origin (`http://localhost:4200`).
Input is validated with `@ag-ui/core/schemas` (`RunAgentInputSchema`) — 400
before the stream starts on invalid bodies. SSE frames are `data: {json}\n\n`,
spec-stripped by TanStack's serializer.

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
| **LLM output quality depends heavily on prompt quality** (A2UI structure + catalog knowledge must reach the model) | System prompt is a dedicated module (`agent-prompt.ts`): tool contract + **SDK-generated `promptSnippet`** (format rules, catalog schemas, examples — the officially recommended content) + guardrails; iterate on it during the Step 14 real-model E2E |
| **TanStack AI youth** — 1.0 shipped Oct 2026, ~553k weekly downloads, volunteer maintainers; API churn possible | Pin exact versions in lockfile; keep TanStack usage isolated in `agent.ts` + `chat-route.ts`; Mastra (`@ag-ui/mastra@2.0.2`) is the documented fallback |
| **`ACTIVITY_SNAPSHOT` support unverified** — older TanStack 0.x docs list `CUSTOM` events but not `ACTIVITY_SNAPSHOT` (AG-UI 1.0 event) | ~~Step 1 verification item~~ → **RESOLVED (2026-11-05)**: TanStack emits tool results as `TOOL_CALL_RESULT`, not `ACTIVITY_SNAPSHOT` — the small `a2ui-snapshot.ts` mapping (part of PLAN Step 8) is required |
| **A2UI maturity** — v0.9 is "early stage public preview"; v1.0 spec is a release candidate; expect churn | Validation, prompt content, and catalog handling delegated to the **official `@a2ui/agent` SDK** (spec-exact by construction; a spec bump = SDK version bump). Renderer config isolated in one client module. The SDK is the same machinery the A2UI team's own samples use |
| **`@a2ui/agent` youth** — v0.1.0, published 2026-11-02 (days old) | It is the official SDK the official samples depend on; pin the version. If it proves unstable, the SDK usage is isolated in the thin `server/src/a2ui/index.ts` wrapper, so a replacement (e.g. a hand-mirrored Zod schema) is a contained change |
| **Zod multi-install** — three copies in the lockfile: `zod@3.25.76` (`@a2ui/web_core` chain), `zod@4.6.7` (our server code), `zod@4.6.6` (`@modelcontextprotocol/*` chain, transitive via `@tanstack/ai`'s MCP support) | pnpm installs them side by side; the integration boundary is plain JSON (tool arguments), never Zod schema objects. Import-hygiene rule: never import Zod-typed values from the SDK/MCP chains into TanStack-facing code |
| **A2UI-over-AG-UI convention is not formally standardized** (`ACTIVITY_SNAPSHOT` + `activityType: 'a2ui-surface'` is the de-facto CopilotKit pattern) | Follow the CopilotKit/angular-architects reference implementation; document our convention in code |
| **Basic Catalog ≠ Material look** | Accept for POC; custom Material catalog is a post-POC workstream |
| **LLM generating invalid A2UI** | Spec-exact `validatePayload` in the tool handler + error text fed back to the model; TanStack's `agentLoopStrategy: maxIterations()` loop provides the retry behavior |
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
- `@a2ui/agent` SDK (A2UI validation + prompt content): https://www.npmjs.com/package/@a2ui/agent — official sample using it: `samples/agent/restaurant_finder` in the a2ui repo
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
