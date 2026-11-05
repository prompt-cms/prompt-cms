/**
 * A2UI integration — thin wrapper around the official `@a2ui/agent` SDK.
 *
 * Replaces the former hand-mirrored Zod schema (superseded): the SDK provides
 * spec-exact validation (`validatePayload`), catalog handling (loaded from the
 * official spec JSON), and prompt content (`DirectJsonPromptGenerator`) —
 * maintained by the A2UI team. A spec bump = SDK version bump.
 *
 * Import hygiene (see SETUP.md risk table): the SDK chain uses Zod 3 while our
 * TanStack-facing code uses Zod 4. The boundary here is plain JSON — never
 * import Zod schema objects from the SDK chain into TanStack-facing code.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CatalogConfig,
  DirectJsonPromptGenerator,
  validatePayload,
} from '@a2ui/agent';

/** Official Basic Catalog spec file (Apache-2.0, from a2ui-project/a2ui v0_9_1). */
const CATALOG_PATH = fileURLToPath(new URL('./spec/catalog.json', import.meta.url));

/**
 * The v0.9 catalog document does not state a protocol version, so it must be
 * passed explicitly (per FileSystemCatalogProvider docs).
 */
const PROTOCOL_VERSION = 'v0.9';

const catalogConfig = CatalogConfig.fromPath(CATALOG_PATH, undefined, PROTOCOL_VERSION);

/** The loaded Basic Catalog (spec-exact). */
export const basicCatalog = catalogConfig.catalog;

/** Official Basic Catalog example — also used as a test fixture. */
export const OFFICIAL_EXAMPLE_PATH = fileURLToPath(
  new URL('./spec/example-login-form.json', import.meta.url),
);

export type ValidationResult =
  | { ok: true }
  | { ok: false; errorText: string };

/**
 * Validates a payload of A2UI messages the way a renderer holding the catalog
 * would. Stateless — designed for one-shot checks such as a tool-call argument
 * (per the SDK README). Throws inside the SDK are converted to a result object
 * so the tool handler can feed the error text back to the model.
 */
export function validateA2uiPayload(operations: unknown): ValidationResult {
  try {
    validatePayload([basicCatalog], operations);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      errorText: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The prompt snippet generated from the catalog: format rules, protocol and
 * catalog schemas, and examples. Consumed by the system prompt (PLAN Step 7).
 * Generated per call — cheap enough for a POC and keeps the wrapper stateless.
 */
export function getPromptSnippet(): string {
  return new DirectJsonPromptGenerator([basicCatalog]).generate();
}

/** Convenience: read the official example's message list (test fixture). */
export function loadOfficialExampleMessages(): unknown[] {
  const doc = JSON.parse(readFileSync(OFFICIAL_EXAMPLE_PATH, 'utf8')) as {
    messages: unknown[];
  };
  return doc.messages;
}
