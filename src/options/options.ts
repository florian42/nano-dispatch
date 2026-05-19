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
  status: requireEl('status'),
};

function showStatus(text: string, kind: 'ok' | 'error'): void {
  els.status.hidden = false;
  els.status.textContent = text;
  els.status.className = kind;
}

async function init(): Promise<void> {
  const cfg = await getConfig();
  els.token.value = cfg.botToken ?? '';
  els.chat.value = cfg.chatId ?? '';
}

els.save.addEventListener('click', () => {
  void (async () => {
    const botToken = els.token.value.trim();
    const chatId = els.chat.value.trim();
    if (botToken.length === 0 || chatId.length === 0) {
      showStatus('Both bot token and chat ID are required.', 'error');
      return;
    }
    await setConfig({ botToken, chatId });
    showStatus('Saved.', 'ok');
  })();
});

void init();
