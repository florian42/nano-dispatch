// Always-on top-frame-only listener. Posts selection text to the side panel
// (and service worker) via chrome.runtime.sendMessage. No DOM mutation, no
// token access, no fetch — see docs/telegram-dispatch.md §7.1.

let lastText = '';
let timer: ReturnType<typeof setTimeout> | null = null;

document.addEventListener('selectionchange', () => {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    const text = window.getSelection()?.toString() ?? '';
    if (text === lastText) return;
    lastText = text;
    chrome.runtime.sendMessage({ type: 'selection', text }).catch(() => {
      /* the side panel may be closed; that's fine */
    });
  }, 150);
});
