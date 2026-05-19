import type { DispatchPayload } from './types.js';

export const SOURCE_TAG = 'source: browser';
export const TELEGRAM_LIMIT = 4096;

const PER_PART_BUDGET = 4032;

export function composeBody(payload: DispatchPayload): string {
  const lines: string[] = [SOURCE_TAG, '', `# ${payload.title}`, payload.url];

  if (payload.selection && payload.selection.length > 0) {
    lines.push('', '## Selection', payload.selection);
  }
  if (payload.note && payload.note.length > 0) {
    lines.push('', '## Note', payload.note);
  }
  if (payload.bodyHtml.length > 0) {
    lines.push('', '## Page', payload.bodyHtml);
  }

  return lines.join('\n');
}

export function composeForTelegram(payload: DispatchPayload): string[] {
  const composed = composeBody(payload);
  if (composed.length <= TELEGRAM_LIMIT) return [composed];

  const prefix = `${SOURCE_TAG}\n\n`;
  const bare = composed.startsWith(prefix) ? composed.slice(prefix.length) : composed;
  const chunks = chunkAtBoundaries(bare, PER_PART_BUDGET);
  const total = chunks.length;
  return chunks.map((chunk, i) => `${SOURCE_TAG}\n(${i + 1}/${total})\n\n${chunk}`);
}

function chunkAtBoundaries(text: string, budget: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > budget) {
    const splitAt = findSplitPoint(remaining, budget);
    chunks.push(remaining.slice(0, splitAt).replace(/\n+$/, ''));
    remaining = remaining.slice(splitAt).replace(/^\n+/, '');
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

function findSplitPoint(text: string, budget: number): number {
  // Only honor a break that's "near" the budget; otherwise it's better to
  // hard-cut at the budget than waste capacity on an early structural newline.
  const minBoundary = Math.floor(budget / 2);
  const paraBreak = text.lastIndexOf('\n\n', budget);
  if (paraBreak > minBoundary) return paraBreak;
  const lineBreak = text.lastIndexOf('\n', budget);
  if (lineBreak > minBoundary) return lineBreak;
  return budget;
}
