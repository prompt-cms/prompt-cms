import { describe, expect, it } from 'vitest';

import { UI_AGENT_TOOL_NAME, buildSystemPrompt } from './agent-prompt.js';

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt();

  it('contains the tool contract', () => {
    expect(prompt).toContain(UI_AGENT_TOOL_NAME);
    expect(prompt).toContain('A2UI protocol messages');
  });

  it('embeds the SDK-generated prompt snippet', () => {
    // The snippet is ~40KB of format rules + catalog schemas + examples.
    expect(prompt.length).toBeGreaterThan(10_000);
    expect(prompt).toContain('createSurface');
    expect(prompt).toContain('updateComponents');
  });

  it('contains the guardrails', () => {
    expect(prompt).toContain('Only use components from the catalog');
    expect(prompt).toContain('update existing surfaces instead of recreating');
  });

  it('injects the current UI state when surface context is provided', () => {
    const ops = [
      { version: 'v0.9', createSurface: { surfaceId: 'dash-1' } },
    ];
    const prompt = buildSystemPrompt(JSON.stringify(ops));
    expect(prompt).toContain('## Current UI state');
    expect(prompt).toContain('createSurface');
    expect(prompt).toContain('SAME surfaceId');
  });

  it('omits the current UI state section without surface context', () => {
    expect(buildSystemPrompt()).not.toContain('## Current UI state');
  });
});
