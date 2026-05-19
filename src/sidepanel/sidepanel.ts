import { mountSidePanel } from './controller.js';
import type { SidePanelPorts, ActiveTab, TabAccess } from './ports.js';
import { getConfig } from '../shared/settings.js';
import { isRestrictedUrl } from '../shared/tab-access.js';
import type { DispatchResult } from '../dispatcher/types.js';

const ports: SidePanelPorts = {
  tabs: {
    async getActive(): Promise<ActiveTab | null> {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) return null;
      return { id: tab.id, title: tab.title ?? '(no title)', url: tab.url ?? '' };
    },
    onActivated(cb) {
      chrome.tabs.onActivated.addListener(() => {
        cb();
      });
    },
    onUpdated(cb) {
      chrome.tabs.onUpdated.addListener((tabId, change) => {
        const next: { title?: string; url?: string } = {};
        if (change.title !== undefined) next.title = change.title;
        if (change.url !== undefined) next.url = change.url;
        cb(tabId, next);
      });
    },
  },
  config: {
    get: getConfig,
  },
  runtime: {
    async send(message) {
      const raw: unknown = await chrome.runtime.sendMessage(message);
      return isDispatchResult(raw) ? raw : undefined;
    },
    openOptionsPage() {
      void chrome.runtime.openOptionsPage();
    },
    onRefreshAccess(cb) {
      chrome.runtime.onMessage.addListener((message) => {
        if (
          typeof message === 'object' &&
          message !== null &&
          (message as { type?: unknown }).type === 'refresh-access'
        ) {
          cb();
        }
        return false;
      });
    },
  },
  scripting: {
    async probe(tabId, url): Promise<TabAccess> {
      if (isRestrictedUrl(url)) return { kind: 'restricted' };
      try {
        const [first] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => window.getSelection()?.toString() ?? '',
        });
        const selection = typeof first?.result === 'string' ? first.result : '';
        return { kind: 'ok', selection };
      } catch {
        return { kind: 'needs_activation' };
      }
    },
  },
};

mountSidePanel(document.body, ports);

function isDispatchResult(v: unknown): v is DispatchResult {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['ok'] === 'boolean';
}
