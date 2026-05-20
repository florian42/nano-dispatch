// Exercises the production dispatcher + GramJS adapter against the real
// Telegram MTProto API, using the session string in .env.
//
// Sends one small HTML document to TG_PEER and prints the DispatchResult.
// On success, the bot at TG_PEER should receive a real inbound user
// message and its update pipeline should fire.

import { dispatch } from '../src/dispatcher/dispatch.js';
import { createGramSender } from '../src/dispatcher/gramjs-sender.js';
import type { DispatchConfig, DispatchPayload, DispatchResult } from '../src/dispatcher/types.js';

function readEnv(): DispatchConfig {
  const apiIdRaw = process.env['TG_API_ID'] ?? '';
  const apiHash = process.env['TG_API_HASH'] ?? '';
  const session = process.env['TG_SESSION'] ?? '';
  const peer = process.env['TG_PEER'] ?? '';

  const missing = [
    !apiIdRaw && 'TG_API_ID',
    !apiHash && 'TG_API_HASH',
    !session && 'TG_SESSION',
    !peer && 'TG_PEER',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `missing env vars: ${missing.join(', ')}. Did you finish auth and paste TG_SESSION?`,
    );
  }
  const apiId = Number(apiIdRaw);
  if (!Number.isFinite(apiId) || apiId <= 0) {
    throw new Error(`TG_API_ID is not a positive number: ${apiIdRaw}`);
  }
  return { apiId, apiHash, session, peer };
}

const config = readEnv();

const payload: DispatchPayload = {
  url: 'https://example.com/probe',
  title: 'CLI probe',
  bodyHtml:
    '<p>hello from scripts/probe-send.ts — proves the production dispatcher works against the real MTProto API.</p>',
  note: 'sent via the CLI probe, not the side panel',
};

console.log('Connecting to Telegram…');
const sender = await createGramSender({
  apiId: config.apiId,
  apiHash: config.apiHash,
  session: config.session,
});

console.log(`Sending to ${config.peer}…`);
let result: DispatchResult;
try {
  result = await dispatch(payload, config, sender);
} finally {
  await sender.disconnect().catch(() => undefined);
}

console.log('');
console.log('=== DispatchResult ===');
console.log(JSON.stringify(result, null, 2));
console.log('======================');

if (!result.ok) process.exit(1);
