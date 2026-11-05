import { describe, expect, it } from 'vitest';

import { APP_NAME, greet } from './smoke.js';

describe('smoke', () => {
  it('exports the app name', () => {
    expect(APP_NAME).toBe('prompt-cms-server');
  });

  it('greets by name', () => {
    expect(greet('POC')).toBe('Hello, POC!');
  });
});
