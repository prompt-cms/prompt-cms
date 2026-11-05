import { Hono } from 'hono';

import { registerChatRoute, type ChatRouteOptions } from './chat-route.js';

export interface AppOptions extends ChatRouteOptions {}

export function createApp(options: AppOptions = {}) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ status: 'ok' }));

  registerChatRoute(app, options);

  return app;
}

export const app = createApp();
