import { describe, expect, it } from 'vitest';

import { loadOfficialExampleMessages } from '../a2ui/index.js';
import { generateUi, generateUiDef } from './generate-ui.js';

describe('generate_ui tool', () => {
  it('accepts the official login-form operations', async () => {
    const operations = loadOfficialExampleMessages();

    const result = await generateUi.execute({ operations });

    expect(result).toEqual({ status: 'ok', operations });
  });

  it('returns a structured error for invalid operations', async () => {
    const operations = [
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
            { id: 'c1', component: 'NotARealComponent', text: 'hello' },
          ],
        },
      },
    ];

    const result = await generateUi.execute({ operations });

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.errorText).toMatch(/NotARealComponent|component/i);
      expect(result.errorText.length).toBeGreaterThan(0);
    }
  });

  it('envelope rejects a non-array operations field', () => {
    const schema = generateUiDef.inputSchema;

    expect(schema).toBeDefined();
    const parsed = schema.safeParse({ operations: 'not-an-array' });

    expect(parsed.success).toBe(false);
  });

  it('envelope rejects a missing operations field', () => {
    const parsed = generateUiDef.inputSchema.safeParse({});

    expect(parsed.success).toBe(false);
  });

  it('output schema accepts both result branches', () => {
    const ok = generateUiDef.outputSchema.safeParse({
      status: 'ok',
      operations: [],
    });
    const error = generateUiDef.outputSchema.safeParse({
      status: 'error',
      errorText: 'bad ops',
    });

    expect(ok.success).toBe(true);
    expect(error.success).toBe(true);
  });
});
