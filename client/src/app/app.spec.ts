import { TestBed } from '@angular/core/testing';
import { COPILOT_KIT_CONFIG } from '@copilotkit/angular';

import { appConfig } from './app.config';
import { App } from './app';
import { EmptySurfaceRenderer } from './surface/empty-surface-renderer';
import { SERVER_CHAT_URL } from './config';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: appConfig.providers,
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('mat-toolbar .title')?.textContent).toContain('Prompt CMS');
  });

  it('should render both panes with layout classes', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('mat-toolbar.topbar')).toBeTruthy();
    expect(compiled.querySelector('.panes')).toBeTruthy();
    expect(compiled.querySelector('section.pane.chat-pane')).toBeTruthy();
    expect(compiled.querySelector('section.pane.ui-pane')).toBeTruthy();
  });

  it('should render the chat element', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('copilot-chat')).toBeTruthy();
  });

  it('should configure the uiAgent pointing at the server chat endpoint', () => {
    const config = TestBed.inject(COPILOT_KIT_CONFIG);
    const agent = config.agents?.['uiAgent'];
    expect(agent).toBeDefined();
    expect((agent as unknown as { url?: string }).url).toBe(SERVER_CHAT_URL);
  });

  it('should enable the A2UI Basic Catalog', () => {
    const config = TestBed.inject(COPILOT_KIT_CONFIG);
    expect(config.a2ui?.catalog).toBeDefined();
  });

  it('should suppress inline chat rendering of a2ui-surface activities', () => {
    const config = TestBed.inject(COPILOT_KIT_CONFIG);
    const suppressor = config.renderActivityMessages?.find(
      (r) => r.activityType === 'a2ui-surface',
    );
    expect(suppressor).toBeDefined();
    expect(suppressor?.component).toBe(EmptySurfaceRenderer);
  });

  it('should host the generated UI in the right pane, not the chat', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const pane = compiled.querySelector('section.pane.ui-pane');
    expect(pane?.querySelector('app-surface-pane')).toBeTruthy();
    // The chat transcript must not host the surface renderer directly.
    expect(compiled.querySelector('.chat-pane copilot-a2ui-activity-renderer')).toBeNull();
  });
});
