export type SendRequest = {
  type: 'send';
  tabId: number;
  note: string;
};

export type ExtensionMessage = SendRequest;
