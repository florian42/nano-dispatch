import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { getByRole, getByText, screen, within } from '@testing-library/dom';
import { mountSidePanel } from '../../src/sidepanel/controller.js';
import type { ActiveTab, SidePanelPorts, TabAccess } from '../../src/sidepanel/ports.js';
import type { DispatchResult } from '../../src/dispatcher/types.js';
import type { Config } from '../../src/shared/settings.js';

interface StubState {
  tab: ActiveTab | null;
  access: TabAccess;
  config: Partial<Config>;
  sendReply: DispatchResult | undefined;
  sentMessages: { type: 'send'; tabId: number; note: string }[];
  openOptionsCalls: number;
  activatedListener: (() => void) | null;
  updatedListener: ((tabId: number, change: { title?: string; url?: string }) => void) | null;
  refreshAccessListener: (() => void) | null;
}

function makePorts(initial?: Partial<StubState>): { ports: SidePanelPorts; state: StubState } {
  const state: StubState = {
    tab: { id: 7, title: 'Example post', url: 'https://example.com/post' },
    access: { kind: 'ok', selection: '' },
    config: { apiId: 1, apiHash: 'HASH', session: 'SESSION', peer: '@nanoclaw' },
    sendReply: { ok: true, messageIds: [1] },
    sentMessages: [],
    openOptionsCalls: 0,
    activatedListener: null,
    updatedListener: null,
    refreshAccessListener: null,
    ...initial,
  };

  const ports: SidePanelPorts = {
    tabs: {
      getActive: () => Promise.resolve(state.tab),
      onActivated(cb) {
        state.activatedListener = cb;
      },
      onUpdated(cb) {
        state.updatedListener = cb;
      },
    },
    config: {
      get: () => Promise.resolve(state.config),
    },
    runtime: {
      send: (msg) => {
        state.sentMessages.push(msg);
        return Promise.resolve(state.sendReply);
      },
      openOptionsPage() {
        state.openOptionsCalls += 1;
      },
      onRefreshAccess(cb) {
        state.refreshAccessListener = cb;
      },
    },
    scripting: {
      probe: () => Promise.resolve(state.access),
    },
  };
  return { ports, state };
}

function makeRoot(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('side-panel controller', () => {
  it('renders the active tab title, url, and a "no selection" chip on mount', async () => {
    const root = makeRoot();
    const { ports } = makePorts();

    const { ready } = mountSidePanel(root, ports);
    await ready;

    expect(getByText(root, 'Example post')).toBeDefined();
    const link = root.querySelector<HTMLAnchorElement>('#page-url');
    expect(link?.textContent).toBe('https://example.com/post');
    expect(link?.href).toBe('https://example.com/post');
    expect(getByText(root, 'no selection')).toBeDefined();
  });

  it('shows the current selection in the chip on mount', async () => {
    const root = makeRoot();
    const { ports } = makePorts({ access: { kind: 'ok', selection: 'initial highlight' } });

    const { ready } = mountSidePanel(root, ports);
    await ready;

    expect(getByText(root, 'initial highlight')).toBeDefined();
  });

  it('shows an actionable hint when activeTab has not been granted for this tab', async () => {
    const root = makeRoot();
    const { ports } = makePorts({ access: { kind: 'needs_activation' } });

    const { ready } = mountSidePanel(root, ports);
    await ready;

    const chip = root.querySelector('#selection-chip');
    expect(chip?.textContent).toMatch(/toolbar icon/i);
    expect(chip?.classList.contains('warn')).toBe(true);
  });

  it('shows a restricted-page hint when the tab URL scheme is unscriptable', async () => {
    const root = makeRoot();
    const { ports } = makePorts({
      tab: { id: 7, title: 'Settings', url: 'chrome://settings' },
      access: { kind: 'restricted' },
    });

    const { ready } = mountSidePanel(root, ports);
    await ready;

    const chip = root.querySelector('#selection-chip');
    expect(chip?.textContent).toMatch(/can't be captured/i);
    expect(chip?.classList.contains('warn')).toBe(true);
  });

  it('re-probes access when the service worker fires onRefreshAccess', async () => {
    const root = makeRoot();
    const { ports, state } = makePorts({ access: { kind: 'needs_activation' } });

    const { ready } = mountSidePanel(root, ports);
    await ready;

    expect(root.querySelector('#selection-chip')?.textContent).toMatch(/toolbar icon/i);

    // Simulate the user clicking the toolbar icon: SW grants activeTab,
    // probe now succeeds.
    state.access = { kind: 'ok', selection: 'now I can read this' };
    state.refreshAccessListener?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(getByText(root, 'now I can read this')).toBeDefined();
  });

  it('on Send: dispatches the note + tabId, shows "Sent", clears the textarea', async () => {
    const user = userEvent.setup();
    const root = makeRoot();
    const { ports, state } = makePorts({
      sendReply: { ok: true, messageIds: [42, 43] },
    });

    const { ready } = mountSidePanel(root, ports);
    await ready;

    const textarea = root.querySelector<HTMLTextAreaElement>('#note-input')!;
    await user.type(textarea, 'sending this');
    await user.click(getByRole(root, 'button', { name: /send/i }));

    expect(state.sentMessages).toEqual([{ type: 'send', tabId: 7, note: 'sending this' }]);
    expect(textarea.value).toBe('');
    expect(getByText(root, /Sent \(2 messages\)/)).toBeDefined();
  });

  it('on Send failure: shows the reason+detail and does NOT clear the textarea', async () => {
    const user = userEvent.setup();
    const root = makeRoot();
    const { ports, state } = makePorts({
      sendReply: { ok: false, reason: 'rate_limited', detail: 'retry_after=5' },
    });

    const { ready } = mountSidePanel(root, ports);
    await ready;

    const textarea = root.querySelector<HTMLTextAreaElement>('#note-input')!;
    await user.type(textarea, 'will not be cleared');
    await user.click(getByRole(root, 'button', { name: /send/i }));

    expect(textarea.value).toBe('will not be cleared');
    expect(state.sentMessages).toHaveLength(1);
    const status = root.querySelector('#status');
    expect(status?.textContent).toContain('rate_limited');
    expect(status?.textContent).toContain('retry_after=5');
  });

  it('on no_access failure: shows the actionable toolbar-icon hint', async () => {
    const user = userEvent.setup();
    const root = makeRoot();
    const { ports } = makePorts({
      sendReply: { ok: false, reason: 'no_access', detail: 'irrelevant' },
    });

    const { ready } = mountSidePanel(root, ports);
    await ready;

    await user.click(getByRole(root, 'button', { name: /send/i }));

    const status = root.querySelector('#status');
    expect(status?.textContent).toMatch(/toolbar icon/i);
  });

  it("on restricted_page failure: shows the can't-be-captured hint", async () => {
    const user = userEvent.setup();
    const root = makeRoot();
    const { ports } = makePorts({
      sendReply: { ok: false, reason: 'restricted_page', detail: 'irrelevant' },
    });

    const { ready } = mountSidePanel(root, ports);
    await ready;

    await user.click(getByRole(root, 'button', { name: /send/i }));

    const status = root.querySelector('#status');
    expect(status?.textContent).toMatch(/can't be captured/i);
  });

  it('blocks Send when no bot token is configured and points the user to options', async () => {
    const user = userEvent.setup();
    const root = makeRoot();
    const { ports, state } = makePorts({ config: {} });

    const { ready } = mountSidePanel(root, ports);
    await ready;

    await user.click(getByRole(root, 'button', { name: /send/i }));

    expect(state.sentMessages).toHaveLength(0);
    expect(getByText(root, /Configure your bot token/i)).toBeDefined();
  });

  it('Cmd+Enter in the note textarea triggers send', async () => {
    const user = userEvent.setup();
    const root = makeRoot();
    const { ports, state } = makePorts();

    const { ready } = mountSidePanel(root, ports);
    await ready;

    const textarea = root.querySelector<HTMLTextAreaElement>('#note-input')!;
    textarea.focus();
    await user.type(textarea, 'shortcut send');
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    expect(state.sentMessages).toEqual([{ type: 'send', tabId: 7, note: 'shortcut send' }]);
  });

  it('keeps each tab’s draft in memory while the panel is open', async () => {
    const user = userEvent.setup();
    const root = makeRoot();
    const { ports, state } = makePorts();

    const { ready } = mountSidePanel(root, ports);
    await ready;

    const textarea = root.querySelector<HTMLTextAreaElement>('#note-input')!;
    await user.type(textarea, 'tab 7 draft');

    // Switch to a different tab.
    state.tab = { id: 9, title: 'Other', url: 'https://example.com/other' };
    state.activatedListener?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(textarea.value).toBe('');

    // Switch back; the original draft is restored.
    state.tab = { id: 7, title: 'Example post', url: 'https://example.com/post' };
    state.activatedListener?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(textarea.value).toBe('tab 7 draft');
  });

  it('clicking "Configure bot…" opens the options page', async () => {
    const user = userEvent.setup();
    const root = makeRoot();
    const { ports, state } = makePorts();

    const { ready } = mountSidePanel(root, ports);
    await ready;

    await user.click(getByText(root, /Configure bot/i));
    expect(state.openOptionsCalls).toBe(1);
  });

  it('refreshes title/url when the active tab updates', async () => {
    const root = makeRoot();
    const { ports, state } = makePorts();

    const { ready } = mountSidePanel(root, ports);
    await ready;

    state.tab = { id: 7, title: 'A new title', url: 'https://example.com/two' };
    state.updatedListener?.(7, { title: 'A new title', url: 'https://example.com/two' });

    // The listener kicks off an async refresh; flush the microtask queue.
    await Promise.resolve();
    await Promise.resolve();

    expect(within(root).getByText('A new title')).toBeDefined();
  });

  it('does not leak between tests (smoke check on the screen helper)', () => {
    expect(screen.queryByText('Example post')).toBeNull();
  });
});
