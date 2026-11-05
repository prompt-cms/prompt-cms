/**
 * A2UI snapshot mapping (PLAN Step 8, part 1).
 *
 * TanStack's `chat()` emits tool results as AG-UI `TOOL_CALL_RESULT` events —
 * not `ACTIVITY_SNAPSHOT`. The CopilotKit/A2UI convention expects the UI
 * payload as an activity snapshot with `activityType: 'a2ui-surface'`, so this
 * transform intercepts the `generate_ui` tool result and appends an
 * `ACTIVITY_SNAPSHOT` carrying the validated A2UI operations.
 *
 * The original `TOOL_CALL_RESULT` is passed through untouched (AG-UI clients
 * use it to maintain message history); the snapshot is additive.
 *
 * Error results (`{ status: 'error', errorText }`) pass through unchanged —
 * the model retries within the agent loop; no snapshot is emitted for them.
 */
/**
 * Typing note: TanStack bundles its own AG-UI event interfaces (structurally
 * identical to `@ag-ui/core`'s, nominally distinct). This module is typed with
 * **TanStack's** `AGUIEvent`/`EventType` (re-exported from `@ag-ui/core` — the
 * same enum object) so the output feeds `toServerSentEventsResponse` directly.
 */
import { EventType, type AGUIEvent } from '@tanstack/ai';

import { UI_AGENT_TOOL_NAME } from './agent-prompt.js';

/** The `generate_ui` tool's result shape (see `tools/generate-ui.ts`). */
export type GenerateUiResult =
  | { status: 'ok'; operations: unknown[] }
  | { status: 'error'; errorText: string };

/** Parses the tool result content (a JSON string) into its typed shape. */
export function parseGenerateUiResult(content: string): GenerateUiResult | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'status' in parsed &&
      ((parsed as { status: unknown }).status === 'ok' ||
        (parsed as { status: unknown }).status === 'error')
    ) {
      return parsed as GenerateUiResult;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Transforms the `chat()` event stream: passes every event through, and after
 * each `generate_ui` tool result with `status: 'ok'` emits an
 * `ACTIVITY_SNAPSHOT` (`activityType: 'a2ui-surface'`) with the operations.
 */
export async function* mapA2uiSnapshots(
  events: AsyncIterable<AGUIEvent>,
): AsyncGenerator<AGUIEvent> {
  /** toolCallId → toolCallName, from TOOL_CALL_START events. */
  const toolNames = new Map<string, string>();

  for await (const event of events) {
    if (event.type === EventType.TOOL_CALL_START) {
      toolNames.set(event.toolCallId, event.toolCallName);
    }

    yield event;

    if (
      event.type === EventType.TOOL_CALL_RESULT &&
      toolNames.get(event.toolCallId) === UI_AGENT_TOOL_NAME &&
      typeof event.content === 'string'
    ) {
      const result = parseGenerateUiResult(event.content);
      if (result?.status === 'ok') {
        yield {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: event.messageId,
          activityType: 'a2ui-surface',
          content: { operations: result.operations },
        };
      }
    }
  }
}
