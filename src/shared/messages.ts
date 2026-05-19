import type { DispatchResult } from '../dispatcher/types.js';

export type SendRequest = {
  type: 'send';
  tabId: number;
  note: string;
};

export type SelectionEvent = {
  type: 'selection';
  text: string;
};

export type ExtensionMessage = SendRequest | SelectionEvent;

export type SendResponse = DispatchResult;

export function isExtensionSender(senderId: string | undefined): boolean {
  return senderId === chrome.runtime.id;
}
