import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';

import { HttpAgent } from '@ag-ui/client';
import { provideCopilotKit } from '@copilotkit/angular';
import { basicCatalog } from '@copilotkit/angular/a2ui';

import { routes } from './app.routes';
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
      // CopilotKit's built-in A2UI support: renders `ACTIVITY_SNAPSHOT`
      // events with `activityType: 'a2ui-surface'` (our server's convention)
      // via the Basic Catalog (PLAN Steps 10–11).
      a2ui: { catalog: basicCatalog },
    }),
  ],
};
