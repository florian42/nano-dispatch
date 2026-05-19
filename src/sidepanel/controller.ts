import { configValid } from '../shared/settings.js';
import type { DispatchResult } from '../dispatcher/types.js';
import type { SidePanelPorts } from './ports.js';
import { SIDEPANEL_TEMPLATE } from './template.js';

export interface SidePanelHandle {
  /** Resolves once the initial tab context has been fetched. */
  ready: Promise<void>;
}

export function mountSidePanel(root: HTMLElement, ports: SidePanelPorts): SidePanelHandle {
  root.innerHTML = SIDEPANEL_TEMPLATE;
  const els = resolve(root);

  let currentTabId: number | undefined;
  const drafts = new Map<number, string>();

  function setSelection(text: string): void {
    if (text.length === 0) {
      els.selection.textContent = 'no selection';
      els.selection.classList.add('empty');
    } else {
      const truncated = text.length > 400 ? `${text.slice(0, 400)}…` : text;
      els.selection.textContent = truncated;
      els.selection.classList.remove('empty');
    }
  }

  function setStatus(text: string, kind: 'ok' | 'error' | '' = ''): void {
    els.status.textContent = text;
    els.status.className = kind;
  }

  async function refreshTabContext(): Promise<void> {
    const tab = await ports.tabs.getActive();
    if (tab === null) return;
    currentTabId = tab.id;
    els.title.textContent = tab.title;
    els.url.textContent = tab.url;
    els.url.href = tab.url || '#';
    els.note.value = drafts.get(tab.id) ?? '';
    setSelection(await ports.scripting.getCurrentSelection(tab.id));
  }

  ports.tabs.onActivated(() => {
    void refreshTabContext();
  });

  ports.tabs.onUpdated((tabId, change) => {
    if (tabId !== currentTabId) return;
    if (change.title !== undefined || change.url !== undefined) {
      void refreshTabContext();
    }
  });

  els.note.addEventListener('input', () => {
    if (currentTabId !== undefined) {
      drafts.set(currentTabId, els.note.value);
    }
  });

  els.note.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void send();
    }
  });

  els.send.addEventListener('click', () => {
    void send();
  });

  els.optionsLink.addEventListener('click', (e) => {
    e.preventDefault();
    ports.runtime.openOptionsPage();
  });

  async function send(): Promise<void> {
    if (currentTabId === undefined) {
      setStatus('No active tab.', 'error');
      return;
    }
    const cfg = await ports.config.get();
    if (!configValid(cfg)) {
      setStatus('Configure your bot token + chat ID first.', 'error');
      return;
    }

    setStatus('Sending…');
    els.send.disabled = true;
    try {
      const reply = await ports.runtime.send({
        type: 'send',
        tabId: currentTabId,
        note: els.note.value,
      });
      if (reply === undefined) {
        setStatus('Failed: no reply from background.', 'error');
        return;
      }
      applyResult(reply, currentTabId);
    } finally {
      els.send.disabled = false;
    }
  }

  function applyResult(reply: DispatchResult, tabId: number): void {
    if (reply.ok) {
      const n = reply.messageIds.length;
      setStatus(`Sent (${n} message${n === 1 ? '' : 's'}).`, 'ok');
      els.note.value = '';
      drafts.delete(tabId);
    } else {
      setStatus(`Failed: ${reply.reason} — ${reply.detail}`, 'error');
    }
  }

  return { ready: refreshTabContext() };
}

interface Elements {
  title: HTMLElement;
  url: HTMLAnchorElement;
  selection: HTMLElement;
  note: HTMLTextAreaElement;
  send: HTMLButtonElement;
  status: HTMLElement;
  optionsLink: HTMLAnchorElement;
}

function resolve(root: ParentNode): Elements {
  return {
    title: must(root, '#page-title'),
    url: must(root, '#page-url') as HTMLAnchorElement,
    selection: must(root, '#selection-chip'),
    note: must(root, '#note-input') as HTMLTextAreaElement,
    send: must(root, '#send-button') as HTMLButtonElement,
    status: must(root, '#status'),
    optionsLink: must(root, '#options-link') as HTMLAnchorElement,
  };
}

function must(root: ParentNode, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}
