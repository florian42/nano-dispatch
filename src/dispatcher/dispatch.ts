import type {
  DispatchPayload,
  DispatchConfig,
  DispatchResult,
  FailureReason,
  Sender,
} from './types.js';
import { composeCaption, composeDocument, documentFilename } from './compose.js';

export async function dispatch(
  payload: DispatchPayload,
  config: DispatchConfig,
  sender: Sender,
): Promise<DispatchResult> {
  const fileBytes = new TextEncoder().encode(composeDocument(payload));
  try {
    const { messageId } = await sender.sendDocument({
      peer: config.peer,
      fileBytes,
      fileName: documentFilename(payload),
      mimeType: 'text/html',
      caption: composeCaption(payload),
    });
    return { ok: true, messageIds: [messageId] };
  } catch (err) {
    const msg = errorMessage(err);
    const reason = classify(msg);
    const detail = reason === 'rate_limited' ? formatFloodDetail(msg) : msg;
    return { ok: false, reason, detail };
  }
}

function classify(msg: string): FailureReason {
  if (msg === 'AUTH_KEY_UNREGISTERED') return 'unauthorized';
  if (msg === 'PEER_ID_INVALID') return 'bad_chat';
  if (/^FLOOD_WAIT_\d+$/.test(msg)) return 'rate_limited';
  if (msg.startsWith('NETWORK_ERROR')) return 'network';
  return 'unknown';
}

function formatFloodDetail(msg: string): string {
  const match = /^FLOOD_WAIT_(\d+)$/.exec(msg);
  return match ? `retry_after=${match[1]}` : msg;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown error';
}
