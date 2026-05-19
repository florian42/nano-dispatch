import type { DispatchPayload } from './types.js';

export const SOURCE_TAG = 'source: browser';

export function composeBody(payload: DispatchPayload): string {
  const lines: string[] = [SOURCE_TAG, '', `# ${payload.title}`, payload.url];

  if (payload.selection && payload.selection.length > 0) {
    lines.push('', '## Selection', payload.selection);
  }

  if (payload.note && payload.note.length > 0) {
    lines.push('', '## Note', payload.note);
  }

  if (payload.bodyMarkdown.length > 0) {
    lines.push('', '## Page', payload.bodyMarkdown);
  }

  return lines.join('\n');
}
