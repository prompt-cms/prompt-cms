/**
 * `generate_ui` — the tool the LLM calls to build or update an A2UI surface.
 *
 * Design (PLAN Step 6):
 * - **Minimal Zod envelope** (`operations: unknown[]`): the real, spec-exact
 *   validation happens in the handler via the official `@a2ui/agent` SDK
 *   (`validateA2uiPayload`). The A2UI format knowledge reaches the model
 *   through the system prompt (`getPromptSnippet()`), not through this schema.
 * - **Error-as-result**: invalid operations return `{ status: 'error',
 *   errorText }` instead of throwing, so the model receives a structured,
 *   explicit signal and can retry within the agent loop (TanStack
 *   `agentLoopStrategy: maxIterations(...)` provides the loop).
 * - Side-effect-free (POC: no persistence).
 */
import { toolDefinition } from '@tanstack/ai';
import { z } from 'zod';

import { validateA2uiPayload } from '../a2ui/index.js';

export const generateUiDef = toolDefinition({
  name: 'generate_ui',
  description:
    'Create or update a UI surface for the user by sending a list of A2UI ' +
    'protocol messages (createSurface, updateComponents, updateDataModel, ' +
    'deleteSurface). Follow the A2UI format rules, component catalog, and ' +
    'examples given in the system prompt. Operations must be a JSON array; ' +
    'each message object needs a "version" field. Invalid operations are ' +
    'rejected with an error message — fix the reported problem and call ' +
    'the tool again.',
  inputSchema: z.object({
    operations: z
      .array(z.unknown())
      .meta({
        description:
          'Ordered list of A2UI protocol messages (see system prompt for the exact format)',
      }),
  }),
  outputSchema: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('ok'),
      operations: z.array(z.unknown()),
    }),
    z.object({
      status: z.literal('error'),
      errorText: z.string().meta({
        description: 'Why the operations were rejected — fix and retry',
      }),
    }),
  ]),
});

export const generateUi = generateUiDef.server(async ({ operations }) => {
  const result = validateA2uiPayload(operations);

  if (result.ok) {
    return { status: 'ok' as const, operations };
  }
  return { status: 'error' as const, errorText: result.errorText };
});
