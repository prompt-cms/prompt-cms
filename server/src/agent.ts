/**
 * UI-generation agent (PLAN Step 7).
 *
 * `runUiAgent()` is a factory so tests can inject a mock adapter
 * (`fakeText()` from `@tanstack/ai/testing`) — no `OPENROUTER_API_KEY`
 * needed for the automated tests. The production adapter is
 * `openRouterText(model)` from `@tanstack/ai-openrouter`, which reads the
 * key from the environment.
 */
import { chat, maxIterations, type ModelMessage } from '@tanstack/ai';
import { openRouterText } from '@tanstack/ai-openrouter';

import { generateUi } from './tools/generate-ui.js';
import { buildSystemPrompt } from './agent-prompt.js';

export const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-sonnet-4.5';

/** Max model turns per run — the loop guard for the validate-and-retry cycle. */
export const MAX_AGENT_ITERATIONS = 10;

/** Any text adapter `chat()` accepts (real OpenRouter or the test fake). */
export type UiAgentAdapter = Parameters<typeof chat>[0]['adapter'];

/**
 * Runs the UI agent: streams AG-UI-compatible chunks while the model
 * generates text and calls the `generate_ui` tool.
 *
 * @param messages conversation history (from the AG-UI `RunAgentInput`)
 * @param threadId thread identifier for the run
 * @param adapter injectable model adapter (defaults to OpenRouter)
 */
export function runUiAgent(
  messages: Array<ModelMessage>,
  threadId: string,
  adapter?: UiAgentAdapter,
) {
  // The adapter's `model` parameter is typed as a union of known model IDs,
  // but `OPENROUTER_MODEL` is a runtime string (any valid OpenRouter slug).
  // For the POC we cast to the default's literal type — the runtime value is
  // what matters; a wrong slug fails at request time, not compile time.
  const model = (process.env.OPENROUTER_MODEL ??
    DEFAULT_OPENROUTER_MODEL) as typeof DEFAULT_OPENROUTER_MODEL;

  return chat({
    adapter: adapter ?? openRouterText(model),
    systemPrompts: [buildSystemPrompt()],
    messages,
    threadId,
    tools: [generateUi],
    agentLoopStrategy: maxIterations(MAX_AGENT_ITERATIONS),
  });
}
