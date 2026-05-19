// Single source of truth for the side-panel markup. The HTML page mounts
// it into <body>; tests mount the same string into a fresh container so
// the DOM under test matches production exactly.
export const SIDEPANEL_TEMPLATE = `
  <header>
    <div id="page-title"></div>
    <a id="page-url" target="_blank" rel="noopener"></a>
  </header>

  <div id="selection-chip" class="empty">no selection</div>

  <textarea id="note-input" placeholder="Write a message…"></textarea>

  <div class="row">
    <button id="send-button" type="button">Send</button>
  </div>

  <div id="status" aria-live="polite"></div>

  <a id="options-link" href="#">Configure bot…</a>
`;
