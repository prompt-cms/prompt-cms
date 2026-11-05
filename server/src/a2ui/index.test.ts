import { describe, expect, it } from 'vitest';

import {
  basicCatalog,
  getPromptSnippet,
  loadOfficialExampleMessages,
  validateA2uiPayload,
} from './index.js';

describe('a2ui wrapper (SDK-backed)', () => {
  it('loads the official Basic Catalog with explicit protocol version', () => {
    expect(basicCatalog).toBeTypeOf('object');
    expect(basicCatalog.protocolVersion).toBe('v0.9');
    expect(basicCatalog.components).toBeInstanceOf(Map);
    expect(basicCatalog.components.size).toBe(18);
  });

  it('validates the official example payload', () => {
    const messages = loadOfficialExampleMessages();

    expect(messages.length).toBeGreaterThan(0);
    expect(validateA2uiPayload(messages)).toEqual({ ok: true });
  });

  it('rejects an unknown component with a usable error text', () => {
    const result = validateA2uiPayload([
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
          components: [
            {
              id: 'c1',
              component: 'NotARealComponent',
              text: 'hello',
            },
          ],
        },
      },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorText).toMatch(/NotARealComponent|component/i);
    }
  });

  it('rejects a message without a version field', () => {
    const result = validateA2uiPayload([
      {
        createSurface: {
          surfaceId: 's1',
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
          sendDataModel: true,
        },
      },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorText).toMatch(/version/i);
    }
  });

  it('rejects a structurally broken payload', () => {
    const result = validateA2uiPayload([{ notAnA2uiMessage: true }]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorText.length).toBeGreaterThan(0);
    }
  });

  it('generates a prompt snippet containing format rules and catalog schemas', () => {
    const snippet = getPromptSnippet();

    expect(snippet.length).toBeGreaterThan(10_000); // ~40KB per earlier verification
    expect(snippet).toContain('createSurface');
    expect(snippet).toContain('updateComponents');
    expect(snippet).toContain('Text');
    expect(snippet).toContain('Column');
  });
});
