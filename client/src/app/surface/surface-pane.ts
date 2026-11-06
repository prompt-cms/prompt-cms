/**
 * Right-pane host for the generated A2UI surface (PLAN Step 13 layout).
 *
 * Instead of relying on CopilotKit's inline chat rendering, this component
 * reads the agent's message store directly and hosts the latest
 * `a2ui-surface` activity message through `CopilotA2UIActivityRenderer` —
 * a standalone component that can be hosted outside the chat transcript
 * ("custom chat shells or non-chat surfaces can host an activity with it
 * directly", per CopilotKit docs).
 *
 * Button clicks and other A2UI actions still round-trip to the agent:
 * `CopilotA2UISurfaceOutlet` bridges actions via the CopilotKit runtime,
 * independent of where the surface is hosted.
 */
import { Component, computed, inject } from '@angular/core';
import type { ActivityMessage } from '@ag-ui/client';
import { CopilotA2UIActivityRenderer, injectAgentStore } from '@copilotkit/angular';

@Component({
  imports: [CopilotA2UIActivityRenderer],
  selector: 'app-surface-pane',
  template: `
    @if (latestSurface(); as msg) {
      <copilot-a2ui-activity-renderer
        [activityType]="msg.activityType"
        [content]="msg.content"
        [message]="msg"
        [agent]="store().agent"
      />
    } @else {
      <div class="placeholder">
        <p>Generated UI will appear here.</p>
        <p class="hint">
          A2UI surfaces stream in as the agent calls
          <code>generate_ui</code>.
        </p>
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }

    copilot-a2ui-activity-renderer {
      flex: 1;
      min-height: 0;
      overflow: auto;
    }

    .placeholder {
      margin: auto;
      text-align: center;
      color: rgba(0, 0, 0, 0.45);
    }

    .placeholder .hint {
      font-size: 0.8125rem;
    }

    .placeholder code {
      background: rgba(0, 0, 0, 0.05);
      padding: 0.1rem 0.3rem;
      border-radius: 4px;
    }
  `,
})
export class SurfacePane {
  protected readonly store = injectAgentStore('uiAgent');

  /** The most recent `a2ui-surface` activity message, if any. */
  readonly latestSurface = computed<ActivityMessage | undefined>(() =>
    [...this.store().messages()]
      .reverse()
      .find(
        (m): m is ActivityMessage =>
          m.role === 'activity' && m.activityType === 'a2ui-surface',
      ),
  );
}
