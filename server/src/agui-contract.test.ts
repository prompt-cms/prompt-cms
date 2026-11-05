/**
 * AG-UI contract test (PLAN Step 9).
 *
 * Validates the SSE frames the server actually emits — after TanStack's
 * spec-stripping (`toWireChunk`) — against the **official `@ag-ui/core`
 * event schemas**. This pins the server→client wire contract independently
 * of TanStack's bundled types and locks in the `ACTIVITY_SNAPSHOT` /
 * `a2ui-surface` convention (SETUP.md §2.3).
 *
 * Uses the mock adapter (no API key) and the real Hono app, so the frames
 * tested are byte-for-byte what a client receives.
 */
import { describe, expect, it } from 'vitest';

import {
  ActivitySnapshotEventSchema,
  EventSchema,
} from '@ag-ui/core/schemas';
import { fakeText } from '@tanstack/ai/testing';

import { validateA2uiPayload } from './a2ui/index.js';
import { createApp } from './index.js';
import {
  makeRunAgentInput,
  mockUiAgentAdapter,
  parseSseFrames,
} from './test-fixtures.js';

async function postChat(adapter: ReturnType<typeof fakeText>) {
  const app = createApp({ adapter });
  return app.request('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(makeRunAgentInput()),
  });
}

describe('AG-UI wire contract (POST /chat SSE frames)', () => {
  it('every emitted frame passes the official @ag-ui/core EventSchema', async () => {
    const res = await postChat(mockUiAgentAdapter());
    expect(res.status).toBe(200);

    const frames = await parseSseFrames(res);
    expect(frames.length).toBeGreaterThan(0);

    for (const frame of frames) {
      const result = EventSchema.safeParse(frame);
      if (!result.success) {
        throw new Error(
          `Frame failed @ag-ui/core validation: ${JSON.stringify(frame)} — ` +
            `${JSON.stringify(result.error.issues)}`,
        );
      }
    }
  });

  it('the ACTIVITY_SNAPSHOT frame follows the a2ui-surface convention', async () => {
    const res = await postChat(mockUiAgentAdapter());
    const frames = await parseSseFrames(res);

    const snapshots = frames.filter(
      (f) =>
        typeof f === 'object' &&
        f !== null &&
        (f as { type?: string }).type === 'ACTIVITY_SNAPSHOT',
    );
    expect(snapshots).toHaveLength(1);

    const parsed = ActivitySnapshotEventSchema.safeParse(snapshots[0]);
    expect(parsed.success).toBe(true);

    const snapshot = parsed.success ? parsed.data : null;
    expect(snapshot?.activityType).toBe('a2ui-surface');
    expect(Array.isArray(snapshot?.content.operations)).toBe(true);
    expect(snapshot?.content.operations.length).toBeGreaterThan(0);
  });

  it('the snapshot content is valid A2UI operations per the @a2ui/agent SDK', async () => {
    const res = await postChat(mockUiAgentAdapter());
    const frames = await parseSseFrames(res);

    const snapshot = frames.find(
      (f) =>
        typeof f === 'object' &&
        f !== null &&
        (f as { type?: string }).type === 'ACTIVITY_SNAPSHOT',
    ) as { content: { operations: unknown[] } } | undefined;

    expect(snapshot).toBeDefined();

    const result = validateA2uiPayload(snapshot!.content.operations);
    expect(result.ok).toBe(true);
  });

  it('RUN_ERROR frames (agent failure path) also pass the EventSchema', async () => {
    const fake = fakeText();
    fake.setResponses([]); // empty queue → the fake errors on the first call

    const res = await postChat(fake);
    expect(res.status).toBe(200);

    const frames = await parseSseFrames(res);
    expect(frames.length).toBeGreaterThan(0);

    for (const frame of frames) {
      const result = EventSchema.safeParse(frame);
      if (!result.success) {
        throw new Error(
          `Frame failed @ag-ui/core validation: ${JSON.stringify(frame)} — ` +
            `${JSON.stringify(result.error.issues)}`,
        );
      }
    }

    const hasRunError = frames.some(
      (f) =>
        typeof f === 'object' &&
        f !== null &&
        (f as { type?: string }).type === 'RUN_ERROR',
    );
    expect(hasRunError).toBe(true);
  });
});
