export type SendRequest = {
  type: 'send';
  tabId: number;
  note: string;
};

// Broadcast from the service worker after the user clicks the toolbar
// icon — activeTab may now be granted for the current tab, so the side
// panel should re-probe. No reply expected.
export type RefreshNotice = {
  type: 'refresh-access';
};

export type ExtensionMessage = SendRequest | RefreshNotice;
