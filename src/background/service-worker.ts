import { dispatch } from '../dispatcher/dispatch.js';
import type { DispatchResult, DispatchPayload } from '../dispatcher/types.js';
import { getConfig, configValid } from '../shared/settings.js';
import type { SendRequest } from '../shared/messages.js';

interface PageCapture {
  url: string;
  title: string;
  selection: string;
  bodyHtml: string;
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  /* may not be supported on older Chrome */
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (!isSendRequest(message)) return false;

  void handleSend(message)
    .then((result) => {
      sendResponse(result);
    })
    .catch((err: unknown) => {
      sendResponse({
        ok: false,
        reason: 'unknown',
        detail: `unhandled: ${stringify(err)}`,
      } satisfies DispatchResult);
    });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(`draft:${tabId}`).catch(() => {
    /* ignore */
  });
});

async function handleSend(req: SendRequest): Promise<DispatchResult> {
  const cfg = await getConfig();
  if (!configValid(cfg)) {
    return {
      ok: false,
      reason: 'unauthorized',
      detail: 'options not configured: paste your bot token and chat ID',
    };
  }

  const capture = await runCapture(req.tabId);
  if (capture === null) {
    return {
      ok: false,
      reason: 'unknown',
      detail: 'capture failed — this page may be restricted (chrome://, web store, etc.)',
    };
  }

  const payload: DispatchPayload = {
    url: capture.url,
    title: capture.title,
    selection: capture.selection,
    note: req.note,
    bodyHtml: capture.bodyHtml,
  };

  return await dispatch(payload, cfg);
}

async function runCapture(tabId: number): Promise<PageCapture | null> {
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        url: location.href,
        title: document.title,
        selection: window.getSelection()?.toString() ?? '',
        bodyHtml: document.body.innerHTML,
      }),
    });
    const result = first?.result;
    return isPageCapture(result) ? result : null;
  } catch {
    return null;
  }
}

function isSendRequest(v: unknown): v is SendRequest {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return o['type'] === 'send' && typeof o['tabId'] === 'number' && typeof o['note'] === 'string';
}

function isPageCapture(v: unknown): v is PageCapture {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['url'] === 'string' &&
    typeof o['title'] === 'string' &&
    typeof o['selection'] === 'string' &&
    typeof o['bodyHtml'] === 'string'
  );
}

function stringify(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return JSON.stringify(err);
}
