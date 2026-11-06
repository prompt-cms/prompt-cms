import { Component, signal } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';

import { CopilotChat } from '@copilotkit/angular';

import { SurfacePane } from './surface/surface-pane';

@Component({
  imports: [CopilotChat, MatToolbarModule, SurfacePane],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('Prompt CMS');
}
