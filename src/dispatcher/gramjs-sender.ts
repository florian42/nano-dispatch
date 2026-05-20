// Production adapter mapping the dispatcher's `Sender` port onto GramJS.
//
// Keeps the dispatcher GramJS-ignorant (see ADR-0010). Re-throws GramJS
// errors with bare TL error names ("AUTH_KEY_UNREGISTERED",
// "PEER_ID_INVALID", "FLOOD_WAIT_30") so the dispatcher's classify() can
// pattern-match. Transport-level failures get a "NETWORK_ERROR:" prefix.

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { CustomFile } from 'telegram/client/uploads.js';
import type { Sender } from './types.js';

export type GramSenderHandle = Sender & {
  disconnect(): Promise<void>;
};

export async function createGramSender(opts: {
  apiId: number;
  apiHash: string;
  session: string;
}): Promise<GramSenderHandle> {
  const client = new TelegramClient(new StringSession(opts.session), opts.apiId, opts.apiHash, {
    connectionRetries: 2,
    // Force WSS — extension CSP / host_permissions only allow
    // wss://*.web.telegram.org, never plain ws://. GramJS's default
    // derives this from `window.location.protocol`, which is
    // `chrome-extension:` in extension contexts and would otherwise
    // make it pick plain WS.
    useWSS: true,
  });

  try {
    await client.connect();
  } catch (err) {
    throw new Error(`NETWORK_ERROR: ${messageOf(err)}`);
  }

  return {
    async sendDocument({ peer, fileBytes, fileName, caption }) {
      // GramJS's CustomFile is the cross-platform path: a browser `File`
      // works in the browser build but is rejected by GramJS's `_fileToMedia`
      // in Node ("Cannot use [object File] as file."). CustomFile carries a
      // Buffer payload that works in both. The mime type is inferred from
      // the file extension by Telegram — for our .html attachments that
      // resolves to text/html.
      const file = new CustomFile(fileName, fileBytes.length, '', Buffer.from(fileBytes));
      try {
        const message = await client.sendFile(peer, {
          file,
          caption,
          forceDocument: true,
        });
        return { messageId: message.id };
      } catch (err) {
        throw normaliseError(err);
      }
    },
    disconnect: () => client.disconnect(),
  };
}

function normaliseError(err: unknown): Error {
  // GramJS RPCError exposes the bare TL name on `errorMessage`. Prefer it;
  // fall back to standard Error.message.
  const e = err as { errorMessage?: unknown; message?: unknown };
  const tl = typeof e.errorMessage === 'string' ? e.errorMessage : undefined;
  const raw = tl ?? messageOf(err);
  if (tl !== undefined) return new Error(tl);
  if (/connect|timeout|ECONNREFUSED|ENOTFOUND|socket|disconnected/i.test(raw)) {
    return new Error(`NETWORK_ERROR: ${raw}`);
  }
  return new Error(raw);
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown error';
}
