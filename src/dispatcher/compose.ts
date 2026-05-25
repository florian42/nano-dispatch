import type { DispatchPayload } from './types.js';

export const SOURCE_TAG = 'source: browser';
export const CAPTION_LIMIT = 1024;

// A dispatch ships as a media group of one or two documents:
//   - the page I'm looking at  → page-<slug>.html   (role: page)
//   - my highlighted selection → selection-<slug>.txt (role: selection)
// The selection file is only added when there is a selection. Both the
// filename prefix and an in-file `role:` marker tell the downstream agent
// which file is which, so it never has to guess from content.
//
// The captions (this file's job) are what the agent reads first, before
// opening any attachment. They describe how the pieces relate — what the
// page is, what the highlight is, and which file holds which — so the agent
// can use the dispatch without reverse-engineering it. We describe, not
// instruct: what the user wants *done* lives in their note.

export function composeCaption(payload: DispatchPayload): string {
  const head = [SOURCE_TAG, '', payload.title, payload.url].join('\n');

  // When a highlight rides along as its own file, name it in the caption so
  // the agent knows that excerpt is the part of the page the user singled out
  // — not buried context it has to go hunting for.
  const footer =
    payload.selection && payload.selection.length > 0
      ? `\n\n— the user highlighted part of this page; the exact text is attached as ${selectionFilename(payload)}`
      : '';

  if (!payload.note || payload.note.length === 0) return clamp(head + footer);

  const withNote = `${head}\n\n${payload.note}${footer}`;
  if (withNote.length <= CAPTION_LIMIT) return withNote;

  // Note pushes us over — keep the head and the (small) selection pointer
  // intact and fit as much of the note as we can. The note also lives in the
  // page document body, so this is a preview, not a loss.
  const available = CAPTION_LIMIT - head.length - footer.length - 3; // \n\n + ellipsis
  if (available <= 0) return clamp(head + footer);
  return `${head}\n\n${payload.note.slice(0, available)}…${footer}`;
}

export function composePageDocument(payload: DispatchPayload): string {
  const parts: string[] = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="x-dispatch-role" content="page">',
    `<title>${escapeText(payload.title)}</title>`,
    `<link rel="canonical" href="${escapeAttr(payload.url)}">`,
    '</head>',
    '<body>',
    '<header>',
    `<p>${SOURCE_TAG} (role: page)</p>`,
    `<h1>${escapeText(payload.title)}</h1>`,
    `<p><a href="${escapeAttr(payload.url)}">${escapeText(payload.url)}</a></p>`,
  ];

  // The selection now ships as its own file — it is intentionally NOT
  // duplicated here. The note stays inline so a note too long for the
  // caption is still preserved in full somewhere.
  if (payload.note && payload.note.length > 0) {
    parts.push('<section><h2>Note</h2>');
    parts.push(`<p>${escapeText(payload.note)}</p>`);
    parts.push('</section>');
  }

  parts.push('</header>', '<hr>', '<main>', payload.bodyHtml, '</main>', '</body>', '</html>');
  return parts.join('\n');
}

// The full highlighted text as its own plain-text file. Plain text (not
// HTML) because `window.getSelection().toString()` is plain text — no markup
// to preserve, no escaping to get wrong. The header block carries the
// machine-readable `role: selection` marker plus enough context (title, url)
// to make the file self-contained if it gets separated from the album.
export function composeSelectionDocument(payload: DispatchPayload): string {
  return [
    SOURCE_TAG,
    'role: selection',
    `title: ${payload.title}`,
    `url: ${payload.url}`,
    '',
    payload.selection ?? '',
  ].join('\n');
}

// Caption shown beneath the selection file in the album. Describes what the
// attached text is and points back to the page file for context, so the agent
// reading the album knows this excerpt is the user's highlight (not the whole
// page) without opening anything.
export function composeSelectionCaption(payload: DispatchPayload): string {
  return [
    SOURCE_TAG,
    'role: selection',
    '',
    'This file is the exact text the user highlighted on the page.',
    `The full page is ${pageFilename(payload)}; the user's note (if any) rides in that file's caption.`,
  ].join('\n');
}

export function pageFilename(payload: DispatchPayload): string {
  const s = slug(payload.title);
  return s ? `page-${s}.html` : 'page.html';
}

export function selectionFilename(payload: DispatchPayload): string {
  const s = slug(payload.title);
  return s ? `selection-${s}.txt` : 'selection.txt';
}

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function clamp(s: string): string {
  return s.length <= CAPTION_LIMIT ? s : s.slice(0, CAPTION_LIMIT);
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}
