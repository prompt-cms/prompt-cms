/**
 * Automated end-to-end test (PLAN Step 15).
 *
 * Boots the **real** Hono app on an ephemeral port and drives it exactly like
 * the Angular client does: `@ag-ui/client`'s `HttpAgent` POSTs a
 * `RunAgentInput` and consumes the SSE stream through the library's own
 * event pipeline. This closes the loop — the same code path the browser uses
 * is now under automated test (mock adapter, so no API key is needed).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { EventType, type BaseEvent } from '@ag-ui/core';
import { HttpAgent } from '@ag-ui/client';

import { createApp } from './index.js';
import { makeRunAgentInput, mockUiAgentAdapter } from './test-fixtures.js';

const app = createApp({ adapter: mockUiAgentAdapter() });

let server: Server;
let port: number;

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Boots the app on an ephemeral port and returns an HttpAgent pointed at it. */
async function startServerAndAgent() {
  server = serve({ fetch: app.fetch, port: 0 }, (info) => {
    port = info.port;
  });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const input = makeRunAgentInput();
  const agent = new HttpAgent({
    url: `http://localhost:${port}/chat`,
    threadId: input.threadId,
    initialMessages: input.messages,
  });
  return { agent, runId: input.runId };
}

describe('HttpAgent end-to-end against the real app', () => {
  it('completes a run with the full expected event sequence and no RUN_ERROR', async () => {
    const { agent, runId } = await startServerAndAgent();

    const events: BaseEvent[] = [];
    const result = await agent.runAgent({ runId }, {
      onEvent: ({ event }) => {
        events.push(event);
      },
    });

    const types = events.map((e) => e.type);

    // The client-side pipeline received a complete, well-formed run.
    expect(types[0]).toBe(EventType.RUN_STARTED);
    expect(types.at(-1)).toBe(EventType.RUN_FINISHED);
    expect(types).not.toContain(EventType.RUN_ERROR);

    // The scripted mock run: tool call → result → snapshot → text summary.
    expect(types).toContain(EventType.TOOL_CALL_START);
    expect(types).toContain(EventType.TOOL_CALL_RESULT);
    expect(types).toContain(EventType.ACTIVITY_SNAPSHOT);
    expect(types).toContain(EventType.TEXT_MESSAGE_CONTENT);

    const snapshot = events.find((e) => e.type === EventType.ACTIVITY_SNAPSHOT) as
      | { activityType: string; content: { operations: unknown[] } }
      | undefined;
    expect(snapshot?.activityType).toBe('a2ui-surface');
    expect(snapshot?.content.operations.length).toBeGreaterThan(0);

    // The library's own result object agrees with the observed stream.
    expect(result.newMessages.length).toBeGreaterThan(0);
  });
});
