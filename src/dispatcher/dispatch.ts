import type {
  DispatchPayload,
  DispatchConfig,
  DispatchResult,
  FailureReason,
  OutgoingDocument,
  Sender,
} from './types.js';
import {
  composeCaption,
  composePageDocument,
  composeSelectionCaption,
  composeSelectionDocument,
  pageFilename,
  selectionFilename,
} from './compose.js';

export async function dispatch(
  payload: DispatchPayload,
  config: DispatchConfig,
  sender: Sender,
): Promise<DispatchResult> {
  const encode = (s: string): Uint8Array => new TextEncoder().encode(s);

  const files: OutgoingDocument[] = [
    {
      fileBytes: encode(composePageDocument(payload)),
      fileName: pageFilename(payload),
      mimeType: 'text/html',
      caption: composeCaption(payload),
    },
  ];

  // Ship the highlight as its own file so it survives in full, with a
  // role-tagged filename + header the agent can key off.
  if (payload.selection && payload.selection.length > 0) {
    files.push({
      fileBytes: encode(composeSelectionDocument(payload)),
      fileName: selectionFilename(payload),
      mimeType: 'text/plain',
      caption: composeSelectionCaption(payload),
    });
  }

  try {
    const { messageIds } = await sender.sendDocuments({ peer: config.peer, files });
    return { ok: true, messageIds };
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
