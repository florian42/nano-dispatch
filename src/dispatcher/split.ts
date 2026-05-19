import type { DispatchPayload } from './types.js';
import { composeBody, SOURCE_TAG } from './compose.js';

export const TELEGRAM_LIMIT = 4096;

const PER_PART_BODY_BUDGET = 4032;

export function splitForTelegram(payload: DispatchPayload): string[] {
  const composed = composeBody(payload);
  if (composed.length <= TELEGRAM_LIMIT) return [composed];

  const framePieces: string[] = [`# ${payload.title}`, payload.url];
  if (payload.selection && payload.selection.length > 0) {
    framePieces.push('', '## Selection', payload.selection);
  }
  if (payload.note && payload.note.length > 0) {
    framePieces.push('', '## Note', payload.note);
  }
  const part1Frame = framePieces.join('\n') + '\n\n## Page\n';
  const pageContent = payload.bodyMarkdown;

  if (part1Frame.length >= PER_PART_BODY_BUDGET) {
    return splitDegenerate(composed);
  }

  const firstPageBudget = PER_PART_BODY_BUDGET - part1Frame.length;
  const pageChunks = chunkPageContent(pageContent, firstPageBudget, PER_PART_BODY_BUDGET);
  const total = pageChunks.length;

  return pageChunks.map((chunk, idx) => {
    const header = `${SOURCE_TAG}\n(${idx + 1}/${total})\n\n`;
    return idx === 0 ? header + part1Frame + chunk : header + chunk;
  });
}

function chunkPageContent(content: string, firstBudget: number, restBudget: number): string[] {
  const chunks: string[] = [];
  let remaining = content;
  let budget = firstBudget;

  while (remaining.length > budget) {
    const splitAt = findSplitPoint(remaining, budget);
    chunks.push(remaining.slice(0, splitAt).replace(/\n+$/, ''));
    remaining = remaining.slice(splitAt).replace(/^\n+/, '');
    budget = restBudget;
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

function findSplitPoint(text: string, budget: number): number {
  const paraBreak = text.lastIndexOf('\n\n', budget);
  if (paraBreak > 0) return paraBreak;
  const lineBreak = text.lastIndexOf('\n', budget);
  if (lineBreak > 0) return lineBreak;
  return budget;
}

function splitDegenerate(composed: string): string[] {
  const sourcePrefix = `${SOURCE_TAG}\n\n`;
  const bare = composed.startsWith(sourcePrefix) ? composed.slice(sourcePrefix.length) : composed;
  const chunks: string[] = [];
  let remaining = bare;
  while (remaining.length > PER_PART_BODY_BUDGET) {
    const splitAt = findSplitPoint(remaining, PER_PART_BODY_BUDGET);
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, '');
  }
  if (remaining.length > 0) chunks.push(remaining);
  const total = chunks.length;
  return chunks.map((chunk, idx) => `${SOURCE_TAG}\n(${idx + 1}/${total})\n\n${chunk}`);
}
