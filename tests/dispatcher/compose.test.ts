import { describe, expect, it } from 'vitest';
import { composeBody } from '../../src/dispatcher/compose.js';

describe('composeBody', () => {
  const base = {
    url: 'https://example.com/post',
    title: 'Hello, world',
    bodyHtml: '# Article\n\nfirst paragraph',
  };

  it('renders source tag, title+url, and all three sections for a full payload', () => {
    const body = composeBody({
      url: 'https://example.com/post',
      title: 'Hello, world',
      selection: 'a notable quote',
      note: 'worth re-reading',
      bodyHtml: '# Article\n\nfirst paragraph',
    });

    expect(body).toBe(
      [
        'source: browser',
        '',
        '# Hello, world',
        'https://example.com/post',
        '',
        '## Selection',
        'a notable quote',
        '',
        '## Note',
        'worth re-reading',
        '',
        '## Page',
        '# Article\n\nfirst paragraph',
      ].join('\n'),
    );
  });

  it('omits the Selection section when selection is missing or empty', () => {
    const body = composeBody({ ...base, note: 'a note' });
    expect(body).not.toContain('## Selection');
    expect(body).toContain('## Note');

    const empty = composeBody({ ...base, selection: '', note: 'a note' });
    expect(empty).not.toContain('## Selection');
  });

  it('omits the Note section when note is missing or empty', () => {
    const body = composeBody({ ...base, selection: 'a quote' });
    expect(body).not.toContain('## Note');
    expect(body).toContain('## Selection');
  });

  it('omits the Page section when bodyHtml is empty', () => {
    const body = composeBody({ ...base, bodyHtml: '' });
    expect(body).not.toContain('## Page');
  });

  it('uses source: browser as the very first line', () => {
    const body = composeBody({ ...base, selection: 's', note: 'n' });
    expect(body.split('\n')[0]).toBe('source: browser');
  });
});
