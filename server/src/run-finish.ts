/**
 * Single-RUN_FINISHED enforcement (PLAN Step 15 finding).
 *
 * TanStack's `chat()` emits a `RUN_FINISHED` chunk **per model turn** (each
 * with its own runId and per-turn usage). The AG-UI protocol requires exactly
 * one `RUN_FINISHED` per run, at the very end — the AG-UI client verifier
 * rejects every event that arrives after the first `RUN_FINISHED`
 * ("The run has already finished with 'RUN_FINISHED'").
 *
 * This transform holds back `RUN_FINISHED` chunks and emits a single one when
 * the stream ends, with:
 * - the `runId` of the run's `RUN_STARTED` (one run = one runId), and
 * - usage aggregated across all turns, mapped from TanStack's field names
 *   (`promptTokens`/`completionTokens`) to AG-UI's (`inputTokens`/`outputTokens`).
 *
 * If the stream errors mid-run, no `RUN_FINISHED` is emitted — the encoder
 * reports the failure as an AG-UI `RUN_ERROR` frame instead.
 */
import type { StreamChunk } from '@tanstack/ai';

type RunFinishedChunk = Extract<StreamChunk, { type: 'RUN_FINISHED' }>;
type RunStartedChunk = Extract<StreamChunk, { type: 'RUN_STARTED' }>;

/**
 * Adds one usage value to the aggregate. TanStack's runtime usage is an object
 * (`promptTokens`/`completionTokens`/`totalTokens`) but its type is a union
 * with AG-UI's array form — handle both, plus both field-name conventions.
 */
function addUsage(
  usage: { inputTokens: number; outputTokens: number; totalTokens: number },
  value: unknown,
): void {
  const entries = Array.isArray(value) ? value : [value];
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue;
    const u = entry as Record<string, number | undefined>;
    usage.inputTokens += u.inputTokens ?? u.promptTokens ?? 0;
    usage.outputTokens += u.outputTokens ?? u.completionTokens ?? 0;
    usage.totalTokens += u.totalTokens ?? 0;
  }
}

export async function* singleRunFinish(
  stream: AsyncIterable<StreamChunk>,
): AsyncGenerator<StreamChunk> {
  let started: RunStartedChunk | undefined;
  let pending: RunFinishedChunk | undefined;
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  for await (const chunk of stream) {
    if (chunk.type === 'RUN_STARTED') {
      started = chunk;
      yield chunk;
      continue;
    }
    if (chunk.type === 'RUN_FINISHED') {
      addUsage(usage, chunk.usage);
      pending = chunk;
      continue;
    }
    yield chunk;
  }

  if (pending) {
    yield {
      ...pending,
      runId: started?.runId ?? pending.runId,
      // AG-UI 1.0: `usage` is an ARRAY of TokenUsage ("one entry per provider
      // and model"). We emit a single entry with the run-wide totals.
      usage: [usage],
    } as RunFinishedChunk;
  }
}
