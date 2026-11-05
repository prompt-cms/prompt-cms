import { describe, expect, it } from 'vitest';

import { fakeText } from '@tanstack/ai/testing';
import type { ModelMessage } from '@tanstack/ai';

import { MAX_AGENT_ITERATIONS, runUiAgent } from './agent.js';
import { loadOfficialExampleMessages } from './a2ui/index.js';

const userMessage: ModelMessage = { role: 'user', content: 'Build me a login form' };

/** Collects the AG-UI events the agent stream emits. */
async function collectEvents(
  ...args: Parameters<typeof runUiAgent>
): Promise<Array<{ type: string } & Record<string, unknown>>> {
  const events: Array<{ type: string } & Record<string, unknown>> = [];
  for await (const chunk of runUiAgent(...args)) {
    events.push(chunk as { type: string } & Record<string, unknown>);
  }
  return events;
}

describe('runUiAgent (mock adapter)', () => {
  it('executes a valid generate_ui tool call and finishes', async () => {
    const validOps = loadOfficialExampleMessages();
    const fake = fakeText();
    fake.setResponses([
      {
        toolCalls: [{ name: 'generate_ui', input: { operations: validOps } }],
      },
      { text: 'Done — I created the login form surface.' },
    ]);

    const events = await collectEvents([userMessage], 'thread-1', fake);

    const types = events.map((e) => e.type);
    expect(types).toContain('RUN_STARTED');
    expect(types).toContain('TOOL_CALL_START');
    const toolStart = events.find((e) => e.type === 'TOOL_CALL_START');
    expect(toolStart?.toolCallName).toBe('generate_ui');
    expect(types).toContain('TOOL_CALL_RESULT');
    const toolResult = events.find((e) => e.type === 'TOOL_CALL_RESULT');
    expect(String(toolResult?.content)).toContain('"status":"ok"');
    expect(types).toContain('TEXT_MESSAGE_START');
    expect(types).toContain('RUN_FINISHED');
    // Two model turns: the tool call, then the summary.
    expect(fake.state.callCount).toBe(2);
  });

  it('surfaces the validation error to the model for retry', async () => {
    const invalidOps = [
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 's1',
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
          sendDataModel: true,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's1',
          components: [{ id: 'c1', component: 'NotARealComponent' }],
        },
      },
    ];
    const fake = fakeText();
    let secondRequestMessages: Array<unknown> = [];
    fake.setResponses([
      { toolCalls: [{ name: 'generate_ui', input: { operations: invalidOps } }] },
      (call) => {
        secondRequestMessages = call.request.messages;
        return { text: 'Sorry, let me fix that.' };
      },
    ]);

    const events = await collectEvents([userMessage], 'thread-2', fake);

    const toolResult = events.find((e) => e.type === 'TOOL_CALL_RESULT');
    expect(String(toolResult?.content)).toContain('"status":"error"');
    expect(String(toolResult?.content)).toContain('NotARealComponent');
    // The error text reached the model in the follow-up turn.
    const serialized = JSON.stringify(secondRequestMessages);
    expect(serialized).toContain('NotARealComponent');
    expect(fake.state.callCount).toBe(2);
  });

  it('ends after one model turn for a plain text response', async () => {
    const fake = fakeText();
    fake.setResponses([{ text: 'I can build UIs — just describe what you need.' }]);

    const events = await collectEvents([userMessage], 'thread-3', fake);

    const types = events.map((e) => e.type);
    expect(types).toContain('RUN_STARTED');
    expect(types).toContain('TEXT_MESSAGE_START');
    expect(types).not.toContain('TOOL_CALL_START');
    expect(types).toContain('RUN_FINISHED');
    expect(fake.state.callCount).toBe(1);
  });

  it('respects the max-iterations loop guard', async () => {
    const fake = fakeText();
    // A model that keeps calling the tool forever must be cut off.
    fake.setResponses(
      Array.from({ length: MAX_AGENT_ITERATIONS + 5 }, () => ({
        toolCalls: [{ name: 'generate_ui', input: { operations: [] } }],
      })),
    );

    const events = await collectEvents([userMessage], 'thread-4', fake);

    // The loop guard cuts the run after MAX_AGENT_ITERATIONS model turns;
    // the stream ends with the final tool result (no further model turn).
    expect(fake.state.callCount).toBeLessThanOrEqual(MAX_AGENT_ITERATIONS);
    expect(events.at(-1)?.type).toBe('TOOL_CALL_RESULT');
  });
});
