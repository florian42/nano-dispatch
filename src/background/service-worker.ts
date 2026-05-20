import { dispatch } from '../dispatcher/dispatch.js';
import { createGramSender } from '../dispatcher/gramjs-sender.js';
import type { DispatchResult, DispatchPayload } from '../dispatcher/types.js';
import { getConfig, configValid } from '../shared/settings.js';
import { isRestrictedUrl } from '../shared/tab-access.js';
import type { SendRequest } from '../shared/messages.js';

interface PageCapture {
  url: string;
  title: string;
  selection: string;
  bodyHtml: string;
}

type CaptureFailure =
  | { kind: 'restricted_page' }
  | { kind: 'no_access'; detail: string }
  | { kind: 'unknown'; detail: string };

type CaptureResult = { kind: 'ok'; value: PageCapture } | CaptureFailure;

// Explicitly disable auto-open. Chrome's auto-open path consumes the
// action click and never grants activeTab, so we must handle the click
// ourselves. The setPanelBehavior value persists across browser
// restarts in the user profile, so we have to actively set it to false
// — not just omit the previous setPanelBehavior({ ...: true }) call.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {
  /* older Chrome versions may not support setPanelBehavior */
});

chrome.action.onClicked.addListener((tab) => {
  void handleActionClick(tab);
});

async function handleActionClick(tab: chrome.tabs.Tab): Promise<void> {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch {
    /* user may have closed the window or sidePanel.open is unsupported */
  }
  // Nudge the side panel to re-probe. The click just granted activeTab for
  // this tab, but tabs.onActivated does NOT fire when the same tab stays
  // active, so the panel wouldn't notice on its own.
  chrome.runtime.sendMessage({ type: 'refresh-access' }).catch(() => {
    /* no listener (panel closed) — nothing to do */
  });
}

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

async function handleSend(req: SendRequest): Promise<DispatchResult> {
  const cfg = await getConfig();
  if (!configValid(cfg)) {
    return {
      ok: false,
      reason: 'unauthorized',
      detail: 'options not configured: sign in to Telegram on the Options page',
    };
  }

  const capture = await runCapture(req.tabId);
  if (capture.kind !== 'ok') {
    return captureFailureToResult(capture);
  }

  const payload: DispatchPayload = {
    url: capture.value.url,
    title: capture.value.title,
    selection: capture.value.selection,
    note: req.note,
    bodyHtml: capture.value.bodyHtml,
  };

  let gramSender;
  try {
    gramSender = await createGramSender({
      apiId: cfg.apiId,
      apiHash: cfg.apiHash,
      session: cfg.session,
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'network',
      detail: stringify(err),
    };
  }

  try {
    return await dispatch(payload, cfg, gramSender);
  } finally {
    await gramSender.disconnect().catch(() => {
      /* ignore — connection cleanup is best-effort */
    });
  }
}

function captureFailureToResult(failure: CaptureFailure): DispatchResult {
  switch (failure.kind) {
    case 'restricted_page':
      return {
        ok: false,
        reason: 'restricted_page',
        detail:
          'Chrome blocks extensions from reading this page (chrome://, Web Store, file://, devtools, etc.).',
      };
    case 'no_access':
      return {
        ok: false,
        reason: 'no_access',
        detail: failure.detail,
      };
    case 'unknown':
      return {
        ok: false,
        reason: 'unknown',
        detail: failure.detail,
      };
  }
}

async function runCapture(tabId: number): Promise<CaptureResult> {
  // Classify by URL first — restricted schemes (chrome://, file://, Web
  // Store, devtools, ...) will always throw from executeScript and
  // there's nothing the user can do about it. Distinguishing this from
  // the "click the toolbar to grant activeTab" case is the whole point.
  const tabUrl = await safeGetTabUrl(tabId);
  if (tabUrl !== null && isRestrictedUrl(tabUrl)) {
    return { kind: 'restricted_page' };
  }

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
    if (isPageCapture(result)) return { kind: 'ok', value: result };
    return { kind: 'unknown', detail: 'executeScript returned an unexpected shape' };
  } catch {
    // The most common throw here is "Cannot access contents of the page"
    // when activeTab hasn't been granted for this tab. Surface it as an
    // actionable reason rather than a generic failure.
    return {
      kind: 'no_access',
      detail:
        'Click the nano-dispatch toolbar icon on this tab to grant access here, then try again.',
    };
  }
}

async function safeGetTabUrl(tabId: number): Promise<string | null> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url ?? null;
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
