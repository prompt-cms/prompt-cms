import { TestBed } from '@angular/core/testing';
import { HttpAgent } from '@ag-ui/client';
import { provideCopilotKit } from '@copilotkit/angular';
import { basicCatalog } from '@copilotkit/angular/a2ui';

import { SurfacePane } from './surface-pane';

/** Minimal valid A2UI operations (same fixture shape the server emits). */
const OPERATIONS = [
  {
    version: 'v0.9',
    createSurface: {
      surfaceId: 's1',
      catalogId: 'https://a2ui.org/specification/v0_9/basic_catalog.json',
    },
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 's1',
      components: [
        { id: 'root', component: 'Column', children: ['title'] },
        { id: 'title', component: 'Text', text: 'Hello' },
      ],
    },
  },
];

function surfaceActivity() {
  return {
    id: 'act-1',
    role: 'activity' as const,
    activityType: 'a2ui-surface',
    content: { operations: OPERATIONS },
  };
}

describe('SurfacePane', () => {
  function configure(agent: HttpAgent) {
    TestBed.configureTestingModule({
      imports: [SurfacePane],
      providers: [
        provideCopilotKit({
          agents: { uiAgent: agent },
          a2ui: { catalog: basicCatalog },
        }),
      ],
    });
  }

  it('renders the placeholder when no surface exists', async () => {
    configure(new HttpAgent({ url: 'http://test/chat' }));
    const fixture = TestBed.createComponent(SurfacePane);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.placeholder')).toBeTruthy();
    expect(el.querySelector('copilot-a2ui-activity-renderer')).toBeNull();
  });

  it('hosts the latest a2ui-surface activity message in the pane', async () => {
    configure(
      new HttpAgent({
        url: 'http://test/chat',
        initialMessages: [surfaceActivity()],
      }),
    );
    const fixture = TestBed.createComponent(SurfacePane);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.placeholder')).toBeNull();
    expect(el.querySelector('copilot-a2ui-activity-renderer')).toBeTruthy();
  });

  it('prefers the latest snapshot when several exist', async () => {
    const older = surfaceActivity();
    const newer = {
      ...surfaceActivity(),
      id: 'act-2',
      content: {
        operations: [
          ...OPERATIONS,
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: 's1',
              components: [
                { id: 'root', component: 'Column', children: ['title', 'extra'] },
                { id: 'title', component: 'Text', text: 'Hello' },
                { id: 'extra', component: 'Text', text: 'Added later' },
              ],
            },
          },
        ],
      },
    };
    configure(
      new HttpAgent({
        url: 'http://test/chat',
        initialMessages: [older, newer],
      }),
    );
    const fixture = TestBed.createComponent(SurfacePane);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.placeholder')).toBeNull();
    expect(el.querySelector('copilot-a2ui-activity-renderer')).toBeTruthy();
    // The pane passes the newest message's content to the renderer.
    expect(fixture.componentInstance.latestSurface()?.id).toBe('act-2');
  });
});
