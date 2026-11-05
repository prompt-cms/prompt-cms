import { Component, signal } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';

import { CopilotChat } from '@copilotkit/angular';

@Component({
  imports: [CopilotChat, MatToolbarModule],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('Prompt CMS');
}
