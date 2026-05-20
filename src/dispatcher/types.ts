export type DispatchPayload = {
  url: string;
  title: string;
  bodyHtml: string;
  selection?: string;
  note?: string;
};

export type DispatchConfig = {
  apiId: number;
  apiHash: string;
  session: string;
  peer: string;
};

export type FailureReason =
  | 'unauthorized'
  | 'bad_chat'
  | 'network'
  | 'rate_limited'
  | 'no_access'
  | 'restricted_page'
  | 'unknown';

export type DispatchResult =
  | { ok: true; messageIds: number[] }
  | { ok: false; reason: FailureReason; detail: string };

export interface Sender {
  sendDocument(input: {
    peer: string;
    fileBytes: Uint8Array;
    fileName: string;
    mimeType: string;
    caption: string;
  }): Promise<{ messageId: number }>;
}
