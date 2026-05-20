// Two-phase Telegram MTProto sign-in CLI.
//
// Phase 1: `auth send-code` — connects with an empty session, asks Telegram
// to send a login code to TG_PHONE, persists the intermediate state
// (partial session + phoneCodeHash) to .scripts-state/auth.json.
//
// Phase 2: `auth complete --code=XXXXX [--password=YYY]` — reloads the
// intermediate state, completes SignIn (and CheckPassword if Telegram
// returns SESSION_PASSWORD_NEEDED), prints the final session string.
//
// The intermediate state is gitignored; the final session string is meant
// to be pasted into .env's TG_SESSION line.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { computeCheck } from 'telegram/Password.js';

const STATE_PATH = '.scripts-state/auth.json';

type State = {
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  phoneCodeHash: string;
  partialSession: string;
};

function readEnv(): { apiId: number; apiHash: string; phoneNumber: string } {
  const apiIdRaw = process.env['TG_API_ID'] ?? '';
  const apiHash = process.env['TG_API_HASH'] ?? '';
  const phoneNumber = process.env['TG_PHONE'] ?? '';
  if (!apiIdRaw || !apiHash || !phoneNumber) {
    throw new Error('TG_API_ID, TG_API_HASH, and TG_PHONE must all be set in .env');
  }
  const apiId = Number(apiIdRaw);
  if (!Number.isFinite(apiId) || apiId <= 0) {
    throw new Error(`TG_API_ID is not a positive number: ${apiIdRaw}`);
  }
  return { apiId, apiHash, phoneNumber };
}

function parseArgs(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of args) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m?.[1] !== undefined && m[2] !== undefined) out[m[1]] = m[2];
  }
  return out;
}

async function sendCode(): Promise<void> {
  const { apiId, apiHash, phoneNumber } = readEnv();
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 2,
  });
  await client.connect();
  const { phoneCodeHash } = await client.sendCode({ apiId, apiHash }, phoneNumber);
  const partialSession = (client.session as StringSession).save();

  const state: State = { apiId, apiHash, phoneNumber, phoneCodeHash, partialSession };
  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
  await client.disconnect();

  console.log('Code sent to', phoneNumber);
  console.log('Intermediate state saved to', STATE_PATH);
  console.log('Run:   npm run auth:complete -- --code=XXXXX [--password=YYY]');
}

async function complete(code: string, password: string | undefined): Promise<void> {
  const stateRaw = await readFile(STATE_PATH, 'utf8');
  const state = JSON.parse(stateRaw) as State;

  const client = new TelegramClient(
    new StringSession(state.partialSession),
    state.apiId,
    state.apiHash,
    { connectionRetries: 2 },
  );
  await client.connect();

  try {
    await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: state.phoneNumber,
        phoneCodeHash: state.phoneCodeHash,
        phoneCode: code,
      }),
    );
  } catch (err) {
    const msg = (err as { errorMessage?: string }).errorMessage ?? String(err);
    if (msg === 'SESSION_PASSWORD_NEEDED') {
      if (!password) {
        console.error('SESSION_PASSWORD_NEEDED — re-run with --password=YOUR_2FA_PASSWORD');
        process.exit(2);
      }
      const passwordSrp = await client.invoke(new Api.account.GetPassword());
      const check = await computeCheck(passwordSrp, password);
      await client.invoke(new Api.auth.CheckPassword({ password: check }));
    } else {
      throw err;
    }
  }

  const session = (client.session as StringSession).save();
  await client.disconnect();

  console.log('');
  console.log('=== SESSION STRING (paste this into TG_SESSION in .env) ===');
  console.log(session);
  console.log('===========================================================');
}

const sub = process.argv[2];
const args = parseArgs(process.argv.slice(3));

if (sub === 'send-code') {
  await sendCode();
} else if (sub === 'complete') {
  const code = args['code'];
  if (!code) {
    console.error('--code=XXXXX is required');
    process.exit(2);
  }
  await complete(code, args['password']);
} else {
  console.error('Usage: tsx scripts/auth.ts send-code');
  console.error('       tsx scripts/auth.ts complete --code=XXXXX [--password=YYY]');
  process.exit(2);
}
