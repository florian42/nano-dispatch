import type { DispatchPayload } from './types.js';

export const SOURCE_TAG = 'source: browser';
export const CAPTION_LIMIT = 1024;

export function composeCaption(payload: DispatchPayload): string {
  const head = [SOURCE_TAG, '', payload.title, payload.url].join('\n');
  if (!payload.note || payload.note.length === 0) return clamp(head);

  const withNote = `${head}\n\n${payload.note}`;
  if (withNote.length <= CAPTION_LIMIT) return withNote;

  // Note pushes us over — keep the head intact and fit as much of the note
  // as we can. The note also lives in the document body, so this is a
  // preview, not a loss.
  const available = CAPTION_LIMIT - head.length - 2 - 1; // \n\n + at least one char
  if (available <= 0) return clamp(head);
  return `${head}\n\n${payload.note.slice(0, available)}…`;
}

export function composeDocument(payload: DispatchPayload): string {
  const parts: string[] = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeText(payload.title)}</title>`,
    `<link rel="canonical" href="${escapeAttr(payload.url)}">`,
    '</head>',
    '<body>',
    '<header>',
    `<p>${SOURCE_TAG}</p>`,
    `<h1>${escapeText(payload.title)}</h1>`,
    `<p><a href="${escapeAttr(payload.url)}">${escapeText(payload.url)}</a></p>`,
  ];

  if (payload.selection && payload.selection.length > 0) {
    parts.push('<section><h2>Selection</h2>');
    parts.push(`<blockquote>${escapeText(payload.selection)}</blockquote>`);
    parts.push('</section>');
  }
  if (payload.note && payload.note.length > 0) {
    parts.push('<section><h2>Note</h2>');
    parts.push(`<p>${escapeText(payload.note)}</p>`);
    parts.push('</section>');
  }

  parts.push('</header>', '<hr>', '<main>', payload.bodyHtml, '</main>', '</body>', '</html>');
  return parts.join('\n');
}

export function documentFilename(payload: DispatchPayload): string {
  const slug = payload.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${slug || 'page'}.html`;
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
