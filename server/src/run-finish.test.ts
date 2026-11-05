import { describe, expect, it } from 'vitest';
import type { StreamChunk } from '@tanstack/ai';

import { singleRunFinish } from './run-finish.js';

/** Minimal chunk factory — only the fields the transform touches. */
function chunk(type: string, extra: Record<string, unknown> = {}): StreamChunk {
  return { type, ...extra } as unknown as StreamChunk;
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

describe('singleRunFinish', () => {
  it('emits exactly one RUN_FINISHED, at the end, with the RUN_STARTED runId', async () => {
    const input = [
      chunk('RUN_STARTED', { runId: 'run-1', threadId: 't1' }),
      chunk('TOOL_CALL_START', { toolCallId: 'c1' }),
      chunk('TOOL_CALL_END', { toolCallId: 'c1' }),
      chunk('RUN_FINISHED', { runId: 'turn-1', usage: { promptTokens: 8, completionTokens: 94, totalTokens: 102 } }),
      chunk('TOOL_CALL_RESULT', { toolCallId: 'c1' }),
      chunk('TEXT_MESSAGE_START', {}),
      chunk('TEXT_MESSAGE_END', {}),
      chunk('RUN_FINISHED', { runId: 'turn-2', usage: { promptTokens: 199, completionTokens: 7, totalTokens: 206 } }),
    ];

    const out = await collect(singleRunFinish(input));
    const types = out.map((c) => (c as { type: string }).type);

    expect(types.filter((t) => t === 'RUN_FINISHED')).toHaveLength(1);
    expect(types.at(-1)).toBe('RUN_FINISHED');
    const finished = out.at(-1) as { runId: string };
    expect(finished.runId).toBe('run-1');
  });

  it('aggregates usage across turns and maps to AG-UI field names', async () => {
    const input = [
      chunk('RUN_STARTED', { runId: 'run-1' }),
      chunk('RUN_FINISHED', { runId: 'turn-1', usage: { promptTokens: 8, completionTokens: 94, totalTokens: 102 } }),
      chunk('RUN_FINISHED', { runId: 'turn-2', usage: { promptTokens: 199, completionTokens: 7, totalTokens: 206 } }),
    ];

    const out = await collect(singleRunFinish(input));
    const finished = out.at(-1) as { usage: Record<string, number> };

    expect(finished.usage).toEqual([{ inputTokens: 207, outputTokens: 101, totalTokens: 308 }]);
  });

  it('emits no RUN_FINISHED when the stream ends without one (error path)', async () => {
    const input = [
      chunk('RUN_STARTED', { runId: 'run-1' }),
      chunk('TOOL_CALL_START', { toolCallId: 'c1' }),
    ];

    const out = await collect(singleRunFinish(input));
    const types = out.map((c) => (c as { type: string }).type);

    expect(types).not.toContain('RUN_FINISHED');
    expect(types).toEqual(['RUN_STARTED', 'TOOL_CALL_START']);
  });

  it('passes a single-turn stream through unchanged apart from usage mapping', async () => {
    const input = [
      chunk('RUN_STARTED', { runId: 'run-1' }),
      chunk('TEXT_MESSAGE_START', {}),
      chunk('TEXT_MESSAGE_END', {}),
      chunk('RUN_FINISHED', { runId: 'run-1', usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } }),
    ];

    const out = await collect(singleRunFinish(input));
    const types = out.map((c) => (c as { type: string }).type);

    expect(types).toEqual(['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_END', 'RUN_FINISHED']);
    expect((out.at(-1) as { usage: Record<string, number>[] }).usage).toEqual([
      { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    ]);
  });
});
