import type { DispatchPayload, DispatchConfig, DispatchResult, FailureReason } from './types.js';
import { composeCaption, composeDocument, documentFilename } from './compose.js';

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
  const url = `https://api.telegram.org/bot${config.botToken}/sendDocument`;
  const form = new FormData();
  form.append('chat_id', config.chatId);
  form.append('caption', composeCaption(payload));
  const blob = new Blob([composeDocument(payload)], { type: 'text/html' });
  form.append('document', blob, documentFilename(payload));

  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', body: form });
  } catch {
    return { ok: false, reason: 'network', detail: 'fetch failed' };
  }

  let parsed: TelegramResponse;
  try {
    parsed = (await res.json()) as TelegramResponse;
  } catch {
    return { ok: false, reason: 'unknown', detail: `http ${res.status}` };
  }

  if (parsed.ok) {
    return { ok: true, messageIds: [parsed.result.message_id] };
  }

  const reason = classifyError(res.status, parsed);
  return { ok: false, reason, detail: formatErrorDetail(reason, parsed) };
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
