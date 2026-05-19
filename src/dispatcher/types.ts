export type DispatchPayload = {
  url: string;
  title: string;
  bodyMarkdown: string;
  selection?: string;
  note?: string;
};

export type DispatchConfig = {
  botToken: string;
  chatId: string;
};

export type FailureReason = 'unauthorized' | 'bad_chat' | 'network' | 'rate_limited' | 'unknown';

export type DispatchResult =
  | { ok: true; messageIds: number[] }
  | { ok: false; reason: FailureReason; detail: string };
