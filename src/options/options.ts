import { getConfig, setConfig } from '../shared/settings.js';

function requireEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

const els = {
  token: requireEl('bot-token') as HTMLInputElement,
  chat: requireEl('chat-id') as HTMLInputElement,
  save: requireEl('save') as HTMLButtonElement,
  test: requireEl('test') as HTMLButtonElement,
  reveal: requireEl('reveal') as HTMLButtonElement,
  verify: requireEl('verify-panel'),
};

function showVerify(text: string, kind: 'ok' | 'error' | 'pending'): void {
  els.verify.hidden = false;
  els.verify.textContent = text;
  els.verify.className = kind === 'pending' ? '' : kind;
}

type TgGetMe = { ok: boolean; result?: { username?: string }; description?: string };
type TgGetChat = {
  ok: boolean;
  result?: { title?: string; first_name?: string };
  description?: string;
};

async function init(): Promise<void> {
  const cfg = await getConfig();
  els.token.value = cfg.botToken ?? '';
  els.chat.value = cfg.chatId ?? '';
}

els.reveal.addEventListener('click', () => {
  els.token.type = els.token.type === 'password' ? 'text' : 'password';
  els.reveal.textContent = els.token.type === 'password' ? 'Reveal' : 'Hide';
});

els.save.addEventListener('click', () => {
  void (async () => {
    const botToken = els.token.value.trim();
    const chatId = els.chat.value.trim();
    if (botToken.length === 0 || chatId.length === 0) {
      showVerify('Both bot token and chat ID are required.', 'error');
      return;
    }
    await setConfig({ botToken, chatId });
    showVerify('Saved.', 'ok');
  })();
});

els.test.addEventListener('click', () => {
  void runTest();
});

async function runTest(): Promise<void> {
  const token = els.token.value.trim();
  const chat = els.chat.value.trim();
  if (token.length === 0 || chat.length === 0) {
    showVerify('Enter both bot token and chat ID first.', 'error');
    return;
  }
  showVerify('Testing…', 'pending');
  try {
    const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const me = (await meRes.json()) as TgGetMe;
    if (!me.ok) {
      showVerify(`getMe failed (HTTP ${meRes.status}): ${me.description ?? 'unknown'}`, 'error');
      return;
    }
    const chatRes = await fetch(
      `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chat)}`,
    );
    const chatData = (await chatRes.json()) as TgGetChat;
    if (!chatData.ok) {
      showVerify(
        `getChat failed (HTTP ${chatRes.status}): ${chatData.description ?? 'unknown'}`,
        'error',
      );
      return;
    }
    const botName = me.result?.username ?? '(unknown)';
    const chatName = chatData.result?.title ?? chatData.result?.first_name ?? '(unknown)';
    showVerify(`✓ Verified — bot @${botName}, chat "${chatName}"`, 'ok');
  } catch (err) {
    showVerify(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

void init();
