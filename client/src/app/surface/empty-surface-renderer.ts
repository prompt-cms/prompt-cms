/**
 * Suppresses CopilotKit's built-in inline A2UI rendering in the chat
 * transcript.
 *
 * Custom `renderActivityMessages` configs take precedence over built-ins, so
 * registering this component for `a2ui-surface` makes the transcript render
 * nothing for surface snapshots. The surface is hosted in the right pane
 * instead (`surface/surface-pane.ts`), which uses
 * `CopilotA2UIActivityRenderer` directly — bypassing renderer resolution.
 *
 * The inputs exist to satisfy CopilotKit's `ActivityRenderer` contract; the
 * component deliberately ignores them.
 */
import { Component, input } from '@angular/core';
import type { AbstractAgent, ActivityMessage } from '@ag-ui/client';
import type { ActivityRenderer } from '@copilotkit/angular';

@Component({
  selector: 'app-empty-surface-renderer',
  template: '',
})
export class EmptySurfaceRenderer implements ActivityRenderer<unknown> {
  readonly activityType = input.required<string>();
  readonly content = input.required<unknown>();
  readonly message = input.required<ActivityMessage>();
  readonly agent = input<AbstractAgent | undefined>();
}
