/**
 * AG-UI `/chat` endpoint (PLAN Step 8, part 2).
 *
 * `POST /chat` accepts an AG-UI `RunAgentInput` (validated with
 * `@ag-ui/core/schemas`), adapts its messages to TanStack `ModelMessage`s,
 * runs the agent stream (Step 7) through the A2UI snapshot mapping (part 1),
 * and returns it as an SSE response via TanStack's `toServerSentEventsResponse`.
 *
 * Typing note: TanStack bundles its own AG-UI event interfaces (structurally
 * identical to `@ag-ui/core`'s, nominally distinct). The server pipeline is
 * typed with **TanStack's** types (`StreamChunk`, `EventType` re-export);
 * `@ag-ui/core` is used for input validation and contract tests only.
 *
 * On agent failure mid-stream, TanStack's encoder emits an AG-UI `RUN_ERROR`
 * frame. Invalid input is rejected with 400 before the stream starts.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { RunAgentInputSchema } from '@ag-ui/core/schemas';
import type { Message } from '@ag-ui/core';
import {
  EventType,
  toServerSentEventsResponse,
  type ModelMessage,
  type StreamChunk,
} from '@tanstack/ai';

import { mapA2uiSnapshots } from './a2ui-snapshot.js';
import { runUiAgent, type UiAgentAdapter } from './agent.js';

export const CHAT_ROUTE_PATH = '/chat';

/**
 * Adapts AG-UI messages to TanStack `ModelMessage`s.
 *
 * TanStack accepts `user | assistant | tool` roles; AG-UI messages can also be
 * `developer | system | activity | reasoning` — those are skipped (the system
 * prompt is built server-side in Step 7). Non-text content parts are flattened
 * to text for the POC (media passthrough is out of scope).
 */
export function toModelMessages(messages: Message[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'tool') {
      continue;
    }
    // AG-UI 1.0: TextPart carries `.text`; AssistantMessage.content is
    // optional (a toolCalls-only assistant message has no text).
    const content =
      m.content === undefined || typeof m.content === 'string'
        ? (m.content ?? '')
        : m.content
            .filter((p) => p.type === 'text')
            .map((p) => p.text)
            .join('\n');
    if (m.role === 'tool') {
      out.push({ role: 'tool', content, toolCallId: m.toolCallId });
    } else {
      out.push({ role: m.role, content });
    }
  }
  return out;
}

export interface ChatRouteOptions {
  /** Injectable adapter for tests (defaults to the OpenRouter adapter). */
  adapter?: UiAgentAdapter;
  /** CORS origin for the Angular dev server (env-overridable in main.ts). */
  origin?: string;
}

export function registerChatRoute(app: Hono, options: ChatRouteOptions = {}) {
  app.use(
    CHAT_ROUTE_PATH,
    cors({
      origin: options.origin ?? 'http://localhost:4200',
      allowHeaders: ['Content-Type'],
      allowMethods: ['POST', 'OPTIONS'],
    }),
  );

  app.post(CHAT_ROUTE_PATH, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = RunAgentInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: 'Invalid RunAgentInput', issues: parsed.error.issues },
        400,
      );
    }

    const input = parsed.data;
    const messages = toModelMessages(input.messages);

    // Synchronous agent failures (e.g. missing OPENROUTER_API_KEY at adapter
    // construction) are reported in-band as an AG-UI RUN_ERROR frame rather
    // than an HTTP 500 — the client speaks AG-UI, so the error should too.
    let stream: AsyncIterable<StreamChunk>;
    try {
      stream = mapA2uiSnapshots(
        runUiAgent(messages, input.threadId, options.adapter),
      ) as AsyncIterable<StreamChunk>;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Agent failed to start';
      const runError: StreamChunk = {
        type: EventType.RUN_ERROR,
        message,
      };
      stream = (async function* () {
        yield runError;
      })();
    }

    return toServerSentEventsResponse(stream);
  });
}
