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

export type OutgoingDocument = {
  fileBytes: Uint8Array;
  fileName: string;
  mimeType: string;
  caption: string;
};

export interface Sender {
  /**
   * Send one or more documents to `peer`. A single file is sent on its own;
   * multiple files ride in one Telegram media group (album) so they arrive
   * grouped, with each file carrying its own caption. Returns the message id
   * of every document that landed, in send order.
   */
  sendDocuments(input: { peer: string; files: OutgoingDocument[] }): Promise<{
    messageIds: number[];
  }>;
}
