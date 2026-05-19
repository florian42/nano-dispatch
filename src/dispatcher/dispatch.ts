import type { DispatchPayload, DispatchConfig, DispatchResult, FailureReason } from './types.js';
import { splitForTelegram } from './split.js';

type FetchFn = typeof fetch;

type TelegramOk = { ok: true; result: { message_id: number } };
type TelegramErr = {
  ok: false;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};
type TelegramResponse = TelegramOk | TelegramErr;

export async function dispatch(
  payload: DispatchPayload,
  config: DispatchConfig,
  fetchImpl: FetchFn = fetch,
): Promise<DispatchResult> {
  const parts = splitForTelegram(payload);
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const messageIds: number[] = [];

  for (let i = 0; i < parts.length; i++) {
    const text = parts[i];
    if (text === undefined) continue;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.chatId,
          text,
          disable_web_page_preview: true,
        }),
      });
    } catch {
      return failure('network', i + 1, parts.length, messageIds, 'fetch failed');
    }

    let parsed: TelegramResponse;
    try {
      parsed = (await res.json()) as TelegramResponse;
    } catch {
      return failure('unknown', i + 1, parts.length, messageIds, `http ${res.status}`);
    }

    if (parsed.ok) {
      messageIds.push(parsed.result.message_id);
      continue;
    }

    const reason = classifyError(res.status, parsed);
    const detailExtra = formatErrorDetail(reason, parsed);
    return failure(reason, i + 1, parts.length, messageIds, detailExtra);
  }

  return { ok: true, messageIds };
}

function classifyError(status: number, body: TelegramErr): FailureReason {
  if (status === 401) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status === 400 && (body.description ?? '').toLowerCase().includes('chat not found')) {
    return 'bad_chat';
  }
  return 'unknown';
}

function formatErrorDetail(reason: FailureReason, body: TelegramErr): string {
  if (reason === 'rate_limited') {
    const retry = body.parameters?.retry_after;
    return retry !== undefined ? `retry_after=${retry}` : 'rate limited';
  }
  return body.description ?? 'no description';
}

function failure(
  reason: FailureReason,
  failedPart: number,
  totalParts: number,
  sentIds: number[],
  extra: string,
): DispatchResult {
  const sentPart = `sent message_ids: [${sentIds.join(', ')}]`;
  const failPart = `failed at part ${failedPart}/${totalParts}: ${extra}`;
  return { ok: false, reason, detail: `${sentPart}; ${failPart}` };
}
