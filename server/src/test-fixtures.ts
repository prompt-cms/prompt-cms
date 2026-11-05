import { fakeText } from '@tanstack/ai/testing';

/**
 * Shared test fixtures — a minimal **valid** A2UI operations list (the real
 * `generate_ui` tool validates via the `@a2ui/agent` SDK, so fixtures must be
 * spec-exact). Shape follows the official example
 * (`a2ui/spec/example-login-form.json`): `createSurface` carries only
 * `surfaceId`/`catalogId`/`sendDataModel`; components arrive via a separate
 * `updateComponents` message.
 */
export const BASIC_CATALOG_ID =
  'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

export const MINIMAL_VALID_OPERATIONS = [
  {
    version: 'v0.9',
    createSurface: {
      surfaceId: 's1',
      catalogId: BASIC_CATALOG_ID,
      sendDataModel: true,
    },
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 's1',
      components: [
        { id: 'root', component: 'Column', children: ['title'] },
        { id: 'title', component: 'Text', text: 'Hello', variant: 'h2' },
      ],
    },
  },
];

/** Scripted run: the model calls `generate_ui`, then summarizes in text. */
export function mockUiAgentAdapter() {
  const fake = fakeText();
  fake.setResponses([
    {
      toolCalls: [
        { name: 'generate_ui', input: { operations: MINIMAL_VALID_OPERATIONS } },
      ],
    },
    { text: 'I built a surface for you.' },
  ]);
  return fake;
}

/** Minimal valid AG-UI `RunAgentInput` for POST /chat. */
export function makeRunAgentInput() {
  return {
    threadId: 't1',
    runId: 'r1',
    messages: [{ id: 'm1', role: 'user' as const, content: 'Build a form' }],
    tools: [],
    context: [],
  };
}

/** Reads an SSE response body and parses each `data: {...}` frame. */
export async function parseSseFrames(res: Response): Promise<unknown[]> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice('data: '.length)));
}

