import { describe, expect, it } from 'vitest';

import { normalizeA2uiOperations } from './normalize.js';

describe('normalizeA2uiOperations', () => {
  it('injects a missing version into a well-formed message', () => {
    const out = normalizeA2uiOperations([
      { createSurface: { surfaceId: 's1', catalogId: 'c1' } },
    ]);
    expect(out).toEqual([
      { version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: 'c1' } },
    ]);
  });

  it('repairs the observed bare {surfaceId, components} payload (gemma failure case)', () => {
    const out = normalizeA2uiOperations([
      { version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: 'c1' } },
      { surfaceId: 's1', components: [{ id: 't1', component: 'Text', text: 'hi' }] },
    ]);
    expect(out).toEqual([
      { version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: 'c1' } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's1',
          components: [{ id: 't1', component: 'Text', text: 'hi' }],
        },
      },
    ]);
  });

  it('repairs a bare components payload without surfaceId by inferring from the last createSurface', () => {
    const out = normalizeA2uiOperations([
      { version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: 'c1' } },
      { components: [{ id: 't1', component: 'Text', text: 'hi' }] },
    ]);
    expect(out[1]).toEqual({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's1',
        components: [{ id: 't1', component: 'Text', text: 'hi' }],
      },
    });
  });

  it('repairs a bare {surfaceId, value} payload as updateDataModel', () => {
    const out = normalizeA2uiOperations([
      { surfaceId: 's1', path: '/', value: { a: 1 } },
    ]);
    expect(out).toEqual([
      { version: 'v0.9', updateDataModel: { surfaceId: 's1', path: '/', value: { a: 1 } } },
    ]);
  });

  it('injects a missing surfaceId into a wrapped updateComponents payload', () => {
    const out = normalizeA2uiOperations([
      { version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: 'c1' } },
      { version: 'v0.9', updateComponents: { components: [] } },
    ]);
    expect(out[1]).toEqual({
      version: 'v0.9',
      updateComponents: { surfaceId: 's1', components: [] },
    });
  });

  it('leaves fully valid operations untouched', () => {
    const valid = [
      { version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: 'c1' } },
      { version: 'v0.9', updateComponents: { surfaceId: 's1', components: [] } },
      { version: 'v0.9', updateDataModel: { surfaceId: 's1', path: '/', value: {} } },
    ];
    expect(normalizeA2uiOperations(valid)).toEqual(valid);
  });

  it('leaves unrecognizable shapes for the SDK validator to reject (version still injected)', () => {
    const weird = [{ foo: 'bar' }, 'not-an-object', 42];
    expect(normalizeA2uiOperations(weird)).toEqual([
      { version: 'v0.9', foo: 'bar' }, // version injected; shape left for SDK
      'not-an-object',
      42,
    ]);
  });

  it('does not mutate the input array', () => {
    const input = [{ surfaceId: 's1', components: [] }];
    const snapshot = structuredClone(input);
    normalizeA2uiOperations(input);
    expect(input).toEqual(snapshot);
  });

  it('passes a bare components payload without any inferable surfaceId through with only the version injected', () => {
    expect(normalizeA2uiOperations([{ components: [] }])).toEqual([
      { version: 'v0.9', components: [] },
    ]);
  });

  it('splits a message that merges two payload keys (observed gemma failure)', () => {
    const out = normalizeA2uiOperations([
      { version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: 'c1' } },
      {
        version: 'v0.9',
        updateComponents: { components: [{ id: 't1', component: 'Text', text: 'hi' }] },
        updateDataModel: { path: '/', value: { a: 1 } },
      },
    ]);
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({
      version: 'v0.9',
      updateDataModel: { surfaceId: 's1', path: '/', value: { a: 1 } },
    });
  });

  it('flattens inline children into ID references and generates missing ids', () => {
    const out = normalizeA2uiOperations([
      { version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: 'c1' } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's1',
          components: [
            {
              id: 'root',
              component: 'Column',
              children: [
                'title',
                {
                  component: 'Text',
                  text: 'nested',
                  children: [{ component: 'Icon', name: 'star' }],
                },
              ],
            },
            { id: 'title', component: 'Text', text: 'hello' },
          ],
        },
      },
    ]);
    const comps = (out[1] as { updateComponents: { components: Array<Record<string, unknown>> } })
      .updateComponents.components;

    // 4 components: root, the nested Text, the nested Icon, title.
    expect(comps).toHaveLength(4);
    // All children are ID strings now.
    const root = comps.find((c) => c.id === 'root');
    expect(root?.children).toEqual(['title', expect.any(String)]);
    const nested = comps.find((c) => c.component === 'Text' && c.text === 'nested');
    expect(typeof nested?.id).toBe('string');
    expect(nested?.children).toEqual([expect.any(String)]);
    const icon = comps.find((c) => c.component === 'Icon');
    expect(typeof icon?.id).toBe('string');
    // No inline objects remain anywhere.
    for (const c of comps) {
      expect(Array.isArray(c.children) && c.children.some((k) => typeof k !== 'string')).toBe(false);
    }
  });

  it('flattens an inline single child', () => {
    const out = normalizeA2uiOperations([
      { version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: 'c1' } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's1',
          components: [
            {
              id: 'card',
              component: 'Card',
              child: { component: 'Text', text: 'inside' },
            },
          ],
        },
      },
    ]);
    const comps = (out[1] as { updateComponents: { components: Array<Record<string, unknown>> } })
      .updateComponents.components;
    expect(comps).toHaveLength(2);
    expect(comps[0].child).toEqual(expect.any(String));
    expect(comps[1].component).toBe('Text');
  });

  it('wraps a single component sent as the updateComponents payload (observed gemma failure)', () => {
    const out = normalizeA2uiOperations([
      { version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: 'c1' } },
      { version: 'v0.9', updateComponents: { component: 'Text', id: 't1', text: 'hi' } },
    ]);

    expect(out[1]).toEqual({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's1',
        components: [{ component: 'Text', id: 't1', text: 'hi' }],
      },
    });
  });

  it('wraps a single component without surfaceId by inferring from the last createSurface', () => {
    const out = normalizeA2uiOperations([
      { version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: 'c1' } },
      { version: 'v0.9', updateComponents: { component: 'Text', id: 't1', text: 'hi' } },
    ]);

    expect((out[1] as Record<string, unknown>).updateComponents).toMatchObject({
      surfaceId: 's1',
    });
  });

  it('generates ids for top-level components that lack one', () => {
    const out = normalizeA2uiOperations([
      { version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: 'c1' } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's1',
          components: [{ component: 'Text', text: 'no id' }],
        },
      },
    ]);
    const comps = (out[1] as { updateComponents: { components: Array<Record<string, unknown>> } })
      .updateComponents.components;
    expect(comps[0].id).toBe('text');
  });

  it('coerces numeric strings for the weight field', () => {
    const out = normalizeA2uiOperations([
      { version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: 'c1' } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's1',
          components: [{ id: 'col', component: 'Column', weight: '1', children: [] }],
        },
      },
    ]);
    const comps = (out[1] as { updateComponents: { components: Array<Record<string, unknown>> } })
      .updateComponents.components;
    expect(comps[0].weight).toBe(1);
  });

  it('avoids id collisions with existing ids', () => {
    const out = normalizeA2uiOperations([
      { version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: 'c1' } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's1',
          components: [
            { id: 'text', component: 'Column', children: [{ component: 'Text', text: 'a' }] },
            { id: 'text_1', component: 'Text', text: 'b' },
          ],
        },
      },
    ]);
    const comps = (out[1] as { updateComponents: { components: Array<Record<string, unknown>> } })
      .updateComponents.components;
    const ids = comps.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
