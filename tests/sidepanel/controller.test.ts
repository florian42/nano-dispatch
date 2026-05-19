import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { getByRole, getByText, screen, within } from '@testing-library/dom';
import { mountSidePanel } from '../../src/sidepanel/controller.js';
import type {
  ActiveTab,
  SelectionEventPayload,
  SidePanelPorts,
} from '../../src/sidepanel/ports.js';
import type { DispatchResult } from '../../src/dispatcher/types.js';
import type { Config } from '../../src/shared/settings.js';

interface StubState {
  tab: ActiveTab | null;
  selection: string;
  draftByTab: Map<number, string>;
  config: Partial<Config>;
  sendReply: DispatchResult | undefined;
  sentMessages: { type: 'send'; tabId: number; note: string }[];
  openOptionsCalls: number;
  selectionListener: ((e: SelectionEventPayload) => void) | null;
  activatedListener: (() => void) | null;
  updatedListener: ((tabId: number, change: { title?: string; url?: string }) => void) | null;
}

function makePorts(initial?: Partial<StubState>): { ports: SidePanelPorts; state: StubState } {
  const state: StubState = {
    tab: { id: 7, title: 'Example post', url: 'https://example.com/post' },
    selection: '',
    draftByTab: new Map(),
    config: { botToken: 'TKN', chatId: 'CHAT' },
    sendReply: { ok: true, messageIds: [1] },
    sentMessages: [],
    openOptionsCalls: 0,
    selectionListener: null,
    activatedListener: null,
    updatedListener: null,
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
    draft: {
      get: (tabId) => Promise.resolve(state.draftByTab.get(tabId) ?? ''),
      set: (tabId, value) => {
        state.draftByTab.set(tabId, value);
        return Promise.resolve();
      },
      clear: (tabId) => {
        state.draftByTab.delete(tabId);
        return Promise.resolve();
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
      onSelectionEvent(cb) {
        state.selectionListener = cb;
      },
      openOptionsPage() {
        state.openOptionsCalls += 1;
      },
    },
    scripting: {
      getCurrentSelection: () => Promise.resolve(state.selection),
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

  it('shows the live selection in the chip and replaces it on a matching selection event', async () => {
    const root = makeRoot();
    const { ports, state } = makePorts({ selection: 'initial highlight' });

    const { ready } = mountSidePanel(root, ports);
    await ready;

    expect(getByText(root, 'initial highlight')).toBeDefined();

    state.selectionListener?.({ tabId: 7, text: 'newer highlight' });
    expect(getByText(root, 'newer highlight')).toBeDefined();
    expect(() => getByText(root, 'initial highlight')).toThrow();
  });

  it('ignores selection events from a different tab', async () => {
    const root = makeRoot();
    const { ports, state } = makePorts({ selection: 'live text' });

    const { ready } = mountSidePanel(root, ports);
    await ready;

    state.selectionListener?.({ tabId: 999, text: 'other tab text' });
    expect(getByText(root, 'live text')).toBeDefined();
    expect(() => getByText(root, 'other tab text')).toThrow();
  });

  it('restores the persisted draft note for the active tab', async () => {
    const root = makeRoot();
    const { ports } = makePorts({ draftByTab: new Map([[7, 'half-written thought']]) });

    const { ready } = mountSidePanel(root, ports);
    await ready;

    const textarea = root.querySelector<HTMLTextAreaElement>('#note-input');
    expect(textarea?.value).toBe('half-written thought');
  });

  it('on Send: dispatches the note + tabId, shows "Sent", clears the textarea and the draft', async () => {
    const user = userEvent.setup();
    const root = makeRoot();
    const { ports, state } = makePorts({
      draftByTab: new Map([[7, 'old draft']]),
      sendReply: { ok: true, messageIds: [42, 43] },
    });

    const { ready } = mountSidePanel(root, ports);
    await ready;

    const textarea = root.querySelector<HTMLTextAreaElement>('#note-input')!;
    await user.clear(textarea);
    await user.type(textarea, 'sending this');
    await user.click(getByRole(root, 'button', { name: /send/i }));

    expect(state.sentMessages).toEqual([{ type: 'send', tabId: 7, note: 'sending this' }]);
    expect(textarea.value).toBe('');
    expect(state.draftByTab.has(7)).toBe(false);
    expect(getByText(root, /Sent \(2 messages\)/)).toBeDefined();
  });

  it('on Send failure: shows the reason+detail and does NOT clear the textarea or draft', async () => {
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

  it('persists the draft note after the debounce window when the user types', async () => {
    vi.useFakeTimers();
    const root = makeRoot();
    const { ports, state } = makePorts();

    const { ready } = mountSidePanel(root, ports);
    await ready;

    const textarea = root.querySelector<HTMLTextAreaElement>('#note-input')!;
    textarea.value = 'still typing';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    expect(state.draftByTab.get(7)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(300);
    expect(state.draftByTab.get(7)).toBe('still typing');
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
    // Each beforeEach wipes document.body; the global screen helper sees nothing left over.
    expect(screen.queryByText('Example post')).toBeNull();
  });
});
