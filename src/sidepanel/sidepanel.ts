import { mountSidePanel } from './controller.js';
import type { SidePanelPorts, ActiveTab } from './ports.js';
import { getConfig } from '../shared/settings.js';
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
  },
  scripting: {
    async getCurrentSelection(tabId) {
      try {
        const [first] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => window.getSelection()?.toString() ?? '',
        });
        return typeof first?.result === 'string' ? first.result : '';
      } catch {
        return '';
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
