import { getConfig, configValid } from '../shared/settings.js';
import type { DispatchResult } from '../dispatcher/types.js';
import type { SelectionEvent } from '../shared/messages.js';

function requireEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

const els = {
  title: requireEl('page-title'),
  url: requireEl('page-url') as HTMLAnchorElement,
  selection: requireEl('selection-chip'),
  note: requireEl('note-input') as HTMLTextAreaElement,
  send: requireEl('send-button') as HTMLButtonElement,
  status: requireEl('status'),
  optionsLink: requireEl('options-link') as HTMLAnchorElement,
};

let currentTabId: number | undefined;
let draftTimer: ReturnType<typeof setTimeout> | null = null;

function setText(el: HTMLElement, text: string): void {
  el.textContent = text;
}

function setSelection(text: string): void {
  if (text.length === 0) {
    setText(els.selection, 'no selection');
    els.selection.classList.add('empty');
  } else {
    const truncated = text.length > 400 ? `${text.slice(0, 400)}…` : text;
    setText(els.selection, truncated);
    els.selection.classList.remove('empty');
  }
}

function setStatus(text: string, kind: 'ok' | 'error' | '' = ''): void {
  setText(els.status, text);
  els.status.className = kind;
}

async function refreshTabContext(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  currentTabId = tab.id;
  setText(els.title, tab.title ?? '(no title)');
  setText(els.url, tab.url ?? '');
  els.url.href = tab.url ?? '#';
  await restoreDraft(currentTabId);
  await pollLiveSelection(currentTabId);
}

async function restoreDraft(tabId: number): Promise<void> {
  const key = `draft:${tabId}`;
  const data = await chrome.storage.session.get(key);
  els.note.value = typeof data[key] === 'string' ? data[key] : '';
}

async function saveDraft(): Promise<void> {
  if (currentTabId === undefined) return;
  await chrome.storage.session.set({ [`draft:${currentTabId}`]: els.note.value });
}

async function pollLiveSelection(tabId: number): Promise<void> {
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.getSelection()?.toString() ?? '',
    });
    const text = first?.result;
    setSelection(typeof text === 'string' ? text : '');
  } catch {
    setSelection('');
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  if (!isSelectionEvent(msg)) return;
  if (sender.tab?.id !== currentTabId) return;
  setSelection(msg.text);
});

chrome.tabs.onActivated.addListener(() => {
  void refreshTabContext();
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (tabId !== currentTabId) return;
  if (change.title !== undefined || change.url !== undefined) void refreshTabContext();
});

els.note.addEventListener('input', () => {
  if (draftTimer !== null) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    void saveDraft();
  }, 250);
});

els.send.addEventListener('click', () => {
  void sendDispatch();
});

els.note.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    void sendDispatch();
  }
});

els.optionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  void chrome.runtime.openOptionsPage();
});

async function sendDispatch(): Promise<void> {
  if (currentTabId === undefined) {
    setStatus('No active tab.', 'error');
    return;
  }
  const cfg = await getConfig();
  if (!configValid(cfg)) {
    setStatus('Configure your bot token + chat ID first.', 'error');
    return;
  }

  setStatus('Sending…');
  els.send.disabled = true;
  try {
    const raw: unknown = await chrome.runtime.sendMessage({
      type: 'send',
      tabId: currentTabId,
      note: els.note.value,
    });

    if (!isDispatchResult(raw)) {
      setStatus('Failed: no reply from background.', 'error');
      return;
    }
    const reply: DispatchResult = raw;
    if (reply.ok) {
      const n = reply.messageIds.length;
      setStatus(`Sent (${n} message${n === 1 ? '' : 's'}).`, 'ok');
      els.note.value = '';
      await chrome.storage.session.remove(`draft:${currentTabId}`);
    } else {
      setStatus(`Failed: ${reply.reason} — ${reply.detail}`, 'error');
    }
  } finally {
    els.send.disabled = false;
  }
}

function isSelectionEvent(v: unknown): v is SelectionEvent {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return o['type'] === 'selection' && typeof o['text'] === 'string';
}

function isDispatchResult(v: unknown): v is DispatchResult {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['ok'] === 'boolean';
}

void refreshTabContext();
