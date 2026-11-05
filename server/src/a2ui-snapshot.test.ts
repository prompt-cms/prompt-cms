import { describe, expect, it } from 'vitest';

import { EventType, type AGUIEvent } from '@ag-ui/core';

import { mapA2uiSnapshots, parseGenerateUiResult } from './a2ui-snapshot.js';
import { MINIMAL_VALID_OPERATIONS } from './test-fixtures.js';

const OPERATIONS = MINIMAL_VALID_OPERATIONS;

function toolStart(id: string): AGUIEvent {
  return {
    type: EventType.TOOL_CALL_START,
    toolCallId: id,
    toolCallName: 'generate_ui',
  };
}

function toolResult(id: string, content: string): AGUIEvent {
  return {
    type: EventType.TOOL_CALL_RESULT,
    messageId: 'msg-1',
    toolCallId: id,
    content,
  };
}

async function collect(events: AGUIEvent[]): Promise<AGUIEvent[]> {
  const out: AGUIEvent[] = [];
  for await (const e of mapA2uiSnapshots(events)) out.push(e);
  return out;
}

describe('parseGenerateUiResult', () => {
  it('parses an ok result', () => {
    const result = parseGenerateUiResult(
      JSON.stringify({ status: 'ok', operations: OPERATIONS }),
    );
    expect(result).toEqual({ status: 'ok', operations: OPERATIONS });
  });

  it('parses an error result', () => {
    const result = parseGenerateUiResult(
      JSON.stringify({ status: 'error', errorText: 'bad ops' }),
    );
    expect(result).toEqual({ status: 'error', errorText: 'bad ops' });
  });

  it('returns null for non-JSON or unknown shapes', () => {
    expect(parseGenerateUiResult('not json')).toBeNull();
    expect(parseGenerateUiResult(JSON.stringify({ foo: 1 }))).toBeNull();
  });
});

describe('mapA2uiSnapshots', () => {
  it('emits an ACTIVITY_SNAPSHOT after a successful generate_ui result', async () => {
    const events: AGUIEvent[] = [
      { type: EventType.RUN_STARTED, threadId: 't1', runId: 'r1' },
      toolStart('call-1'),
      toolResult('call-1', JSON.stringify({ status: 'ok', operations: OPERATIONS })),
      { type: EventType.RUN_FINISHED },
    ];

    const out = await collect(events);

    expect(out).toHaveLength(5);
    const snapshot = out[3];
    expect(snapshot.type).toBe(EventType.ACTIVITY_SNAPSHOT);
    if (snapshot.type === EventType.ACTIVITY_SNAPSHOT) {
      expect(snapshot.activityType).toBe('a2ui-surface');
      expect(snapshot.content).toEqual({ operations: OPERATIONS });
      expect(snapshot.messageId).toBe('msg-1');
    }
  });

  it('passes through error results without a snapshot', async () => {
    const events: AGUIEvent[] = [
      toolStart('call-1'),
      toolResult('call-1', JSON.stringify({ status: 'error', errorText: 'bad' })),
    ];

    const out = await collect(events);

    expect(out).toHaveLength(2);
    expect(out.some((e) => e.type === EventType.ACTIVITY_SNAPSHOT)).toBe(false);
  });

  it('ignores tool results from other tools', async () => {
    const events: AGUIEvent[] = [
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: 'call-2',
        toolCallName: 'other_tool',
      },
      toolResult('call-2', JSON.stringify({ status: 'ok', operations: OPERATIONS })),
    ];

    const out = await collect(events);

    expect(out).toHaveLength(2);
    expect(out.some((e) => e.type === EventType.ACTIVITY_SNAPSHOT)).toBe(false);
  });

  it('passes through non-tool events unchanged', async () => {
    const events: AGUIEvent[] = [
      { type: EventType.RUN_STARTED, threadId: 't1', runId: 'r1' },
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId: 'm1',
        role: 'assistant',
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: 'm1',
        delta: 'hello',
      },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'm1' },
      { type: EventType.RUN_FINISHED },
    ];

    const out = await collect(events);

    expect(out).toEqual(events);
  });
});
