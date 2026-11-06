import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';

import { HttpAgent } from '@ag-ui/client';
import {
  anyActivityContentSchema,
  provideCopilotKit,
} from '@copilotkit/angular';
import { basicCatalog } from '@copilotkit/angular/a2ui';

import { routes } from './app.routes';
import { EmptySurfaceRenderer } from './surface/empty-surface-renderer';
import { SERVER_CHAT_URL } from './config';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAnimationsAsync(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideCopilotKit({
      agents: {
        uiAgent: new HttpAgent({ url: SERVER_CHAT_URL }),
      },
      // CopilotKit's built-in A2UI support: the catalog powers the surface
      // component the pane renders and adds catalog/schema context for the
      // agent (PLAN Steps 10–11).
      a2ui: { catalog: basicCatalog },
      // Suppress the built-in inline rendering of `a2ui-surface` activity
      // messages in the chat transcript: custom renderers take precedence
      // over built-ins, and this one renders nothing. The surface is hosted
      // in the right pane instead (surface/surface-pane.ts).
      renderActivityMessages: [
        {
          activityType: 'a2ui-surface',
          content: anyActivityContentSchema,
          component: EmptySurfaceRenderer,
        },
      ],
    }),
  ],
};
