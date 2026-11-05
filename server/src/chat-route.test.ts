import { describe, expect, it } from 'vitest';

import { EventType } from '@ag-ui/core';
import { fakeText } from '@tanstack/ai/testing';

import { createApp } from './index.js';
import {
  makeRunAgentInput,
  mockUiAgentAdapter,
  parseSseFrames,
} from './test-fixtures.js';

describe('POST /chat', () => {
  it('returns a text/event-stream response', async () => {
    const app = createApp({ adapter: mockUiAgentAdapter() });
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeRunAgentInput()),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  it('streams the full AG-UI event sequence for a tool-call run', async () => {
    const app = createApp({ adapter: mockUiAgentAdapter() });
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeRunAgentInput()),
    });

    const events = await parseSseFrames(res);
    const types = events.map((e) => e.type);

    // RUN_* strictly first/last.
    expect(types[0]).toBe(EventType.RUN_STARTED);
    expect(types.at(-1)).toBe(EventType.RUN_FINISHED);

    // TOOL_CALL_START/ARGS/END strictly together; the orchestrator emits
    // TOOL_CALL_RESULT after the first turn's RUN_FINISHED (turn boundary).
    const toolIdx = types.indexOf(EventType.TOOL_CALL_START);
    expect(toolIdx).toBeGreaterThan(0);
    expect(types[toolIdx + 1]).toBe(EventType.TOOL_CALL_ARGS);
    expect(types[toolIdx + 2]).toBe(EventType.TOOL_CALL_END);
    expect(types).toContain(EventType.TOOL_CALL_RESULT);
    expect(types.indexOf(EventType.TOOL_CALL_RESULT)).toBeGreaterThan(
      types.indexOf(EventType.RUN_FINISHED),
    );

    const start = events[toolIdx];
    expect(start.type === EventType.TOOL_CALL_START && start.toolCallName).toBe(
      'generate_ui',
    );

    // ACTIVITY_SNAPSHOT and TEXT_MESSAGE_* groups may interleave freely
    // (their relative order depends on model behavior); both must appear.
    expect(types).toContain(EventType.ACTIVITY_SNAPSHOT);
    expect(types).toContain(EventType.TEXT_MESSAGE_START);
    expect(types).toContain(EventType.TEXT_MESSAGE_CONTENT);
    expect(types).toContain(EventType.TEXT_MESSAGE_END);

    const snapshot = events.find((e) => e.type === EventType.ACTIVITY_SNAPSHOT);
    expect(
      snapshot?.type === EventType.ACTIVITY_SNAPSHOT && snapshot.activityType,
    ).toBe('a2ui-surface');
  });

  it('rejects a malformed body with 400 before the stream starts', async () => {
    const app = createApp({ adapter: mockUiAgentAdapter() });
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: 't1', runId: 'r1' }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid RunAgentInput');
  });

  it('rejects invalid JSON with 400', async () => {
    const app = createApp({ adapter: mockUiAgentAdapter() });
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid JSON body');
  });

  it('emits a RUN_ERROR frame when the agent fails mid-stream', async () => {
    const fake = fakeText();
    fake.setResponses([]); // empty queue → the fake errors on the first call
    const app = createApp({ adapter: fake });
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeRunAgentInput()),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const events = await parseSseFrames(res);
    const runError = events.find((e) => e.type === EventType.RUN_ERROR);
    expect(runError).toBeDefined();
  });
});
