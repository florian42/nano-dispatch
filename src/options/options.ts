import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { computeCheck } from 'telegram/Password.js';
import { getConfig, setConfig, clearSession } from '../shared/settings.js';

function requireEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

const els = {
  banner: requireEl('signed-in-banner') as HTMLDivElement,
  signOut: requireEl('sign-out') as HTMLButtonElement,
  apiId: requireEl('api-id') as HTMLInputElement,
  apiHash: requireEl('api-hash') as HTMLInputElement,
  peer: requireEl('peer') as HTMLInputElement,
  authHeading: requireEl('auth-section-heading') as HTMLHeadingElement,
  stepPhone: requireEl('auth-step-phone') as HTMLDivElement,
  stepCode: requireEl('auth-step-code') as HTMLDivElement,
  phone: requireEl('phone') as HTMLInputElement,
  sendCode: requireEl('send-code') as HTMLButtonElement,
  code: requireEl('code') as HTMLInputElement,
  password: requireEl('password') as HTMLInputElement,
  submitCode: requireEl('submit-code') as HTMLButtonElement,
  cancelCode: requireEl('cancel-code') as HTMLButtonElement,
  status: requireEl('status') as HTMLDivElement,
};

type PendingLogin = {
  client: TelegramClient;
  phoneNumber: string;
  phoneCodeHash: string;
};

let pending: PendingLogin | null = null;

function showStatus(text: string, kind: 'ok' | 'error' | 'info'): void {
  els.status.hidden = false;
  els.status.textContent = text;
  els.status.className = `status ${kind === 'info' ? '' : kind}`;
}

function hideStatus(): void {
  els.status.hidden = true;
  els.status.textContent = '';
}

function showStep(step: 'phone' | 'code' | 'none'): void {
  els.stepPhone.classList.toggle('hidden', step !== 'phone');
  els.stepCode.classList.toggle('hidden', step !== 'code');
  els.authHeading.classList.toggle('hidden', step === 'none');
}

async function init(): Promise<void> {
  const cfg = await getConfig();
  els.apiId.value = cfg.apiId !== undefined ? String(cfg.apiId) : '';
  els.apiHash.value = cfg.apiHash ?? '';
  els.peer.value = cfg.peer ?? '';

  const signedIn = typeof cfg.session === 'string' && cfg.session.length > 0;
  els.banner.classList.toggle('hidden', !signedIn);
  showStep(signedIn ? 'none' : 'phone');
}

function readAppCreds(): { apiId: number; apiHash: string; peer: string } | null {
  const apiIdRaw = els.apiId.value.trim();
  const apiHash = els.apiHash.value.trim();
  const peer = els.peer.value.trim();
  if (!apiIdRaw || !apiHash || !peer) {
    showStatus('api_id, api_hash, and recipient are all required.', 'error');
    return null;
  }
  const apiId = Number(apiIdRaw);
  if (!Number.isFinite(apiId) || apiId <= 0) {
    showStatus('api_id must be a positive number.', 'error');
    return null;
  }
  return { apiId, apiHash, peer };
}

els.sendCode.addEventListener('click', () => {
  void (async () => {
    const creds = readAppCreds();
    if (!creds) return;

    const phone = els.phone.value.trim();
    if (!phone) {
      showStatus('Phone number is required.', 'error');
      return;
    }

    els.sendCode.disabled = true;
    showStatus('Connecting to Telegram…', 'info');

    try {
      const client = new TelegramClient(new StringSession(''), creds.apiId, creds.apiHash, {
        connectionRetries: 2,
        useWSS: true,
      });
      await client.connect();
      const { phoneCodeHash } = await client.sendCode(
        { apiId: creds.apiId, apiHash: creds.apiHash },
        phone,
      );
      pending = { client, phoneNumber: phone, phoneCodeHash };
      showStep('code');
      showStatus('Code sent. Check Telegram for the login code.', 'ok');
    } catch (err) {
      showStatus(`Could not send code: ${describeErr(err)}`, 'error');
    } finally {
      els.sendCode.disabled = false;
    }
  })();
});

els.cancelCode.addEventListener('click', () => {
  void (async () => {
    if (pending) {
      await pending.client.disconnect().catch(() => undefined);
      pending = null;
    }
    showStep('phone');
    hideStatus();
  })();
});

els.submitCode.addEventListener('click', () => {
  void (async () => {
    if (!pending) {
      showStatus('Login session lost — please send a new code.', 'error');
      showStep('phone');
      return;
    }

    const creds = readAppCreds();
    if (!creds) return;

    const code = els.code.value.trim();
    if (!code) {
      showStatus('Login code is required.', 'error');
      return;
    }

    els.submitCode.disabled = true;
    showStatus('Signing in…', 'info');

    const { client, phoneNumber, phoneCodeHash } = pending;
    try {
      await client.invoke(new Api.auth.SignIn({ phoneNumber, phoneCodeHash, phoneCode: code }));
    } catch (err) {
      const msg = (err as { errorMessage?: string }).errorMessage ?? describeErr(err);
      if (msg === 'SESSION_PASSWORD_NEEDED') {
        const pwd = els.password.value;
        if (!pwd) {
          showStatus('Two-factor password required.', 'error');
          els.submitCode.disabled = false;
          return;
        }
        try {
          const passwordSrp = await client.invoke(new Api.account.GetPassword());
          const check = await computeCheck(passwordSrp, pwd);
          await client.invoke(new Api.auth.CheckPassword({ password: check }));
        } catch (err2) {
          showStatus(`Two-factor sign-in failed: ${describeErr(err2)}`, 'error');
          els.submitCode.disabled = false;
          return;
        }
      } else {
        showStatus(`Sign-in failed: ${msg}`, 'error');
        els.submitCode.disabled = false;
        return;
      }
    }

    const session = (client.session as StringSession).save();
    await setConfig({
      apiId: creds.apiId,
      apiHash: creds.apiHash,
      session,
      peer: creds.peer,
    });
    await client.disconnect().catch(() => undefined);
    pending = null;

    els.code.value = '';
    els.password.value = '';
    els.banner.classList.remove('hidden');
    showStep('none');
    showStatus('Signed in. You can close this page.', 'ok');
    els.submitCode.disabled = false;
  })();
});

els.signOut.addEventListener('click', () => {
  void (async () => {
    await clearSession();
    els.banner.classList.add('hidden');
    showStep('phone');
    showStatus('Signed out. Existing session string cleared from local storage.', 'ok');
  })();
});

function describeErr(err: unknown): string {
  const e = err as { errorMessage?: unknown; message?: unknown };
  if (typeof e.errorMessage === 'string') return e.errorMessage;
  if (typeof e.message === 'string') return e.message;
  return String(err);
}

void init();
