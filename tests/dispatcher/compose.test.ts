import { describe, expect, it } from 'vitest';
import {
  composeCaption,
  composePageDocument,
  composeSelectionDocument,
  composeSelectionCaption,
  pageFilename,
  selectionFilename,
  CAPTION_LIMIT,
} from '../../src/dispatcher/compose.js';

const base = {
  url: 'https://example.com/post',
  title: 'Hello, world',
  bodyHtml: '<p>first paragraph</p>',
};

describe('composeCaption', () => {
  it('leads with the source tag, then title and url', () => {
    const caption = composeCaption(base);
    expect(caption).toBe('source: browser\n\nHello, world\nhttps://example.com/post');
  });

  it('appends the note as a trailing block when present', () => {
    const caption = composeCaption({ ...base, note: 'worth re-reading' });
    expect(caption).toBe(
      'source: browser\n\nHello, world\nhttps://example.com/post\n\nworth re-reading',
    );
  });

  it('omits the note section when note is empty', () => {
    const caption = composeCaption({ ...base, note: '' });
    expect(caption).toBe('source: browser\n\nHello, world\nhttps://example.com/post');
  });

  it('stays within the Telegram caption limit even with a giant note', () => {
    const huge = 'x'.repeat(5000);
    const caption = composeCaption({ ...base, note: huge });
    expect(caption.length).toBeLessThanOrEqual(CAPTION_LIMIT);
    expect(caption.startsWith('source: browser\n\nHello, world\nhttps://example.com/post')).toBe(
      true,
    );
  });

  it('points the agent at the selection file when a highlight is present', () => {
    const caption = composeCaption({ ...base, selection: 'a notable quote' });
    expect(caption).toContain('the user highlighted part of this page');
    expect(caption).toContain('selection-hello-world.txt');
  });

  it('adds no selection pointer when there is no highlight', () => {
    const caption = composeCaption(base);
    expect(caption).not.toContain('highlighted');
    expect(caption).not.toContain('selection-');
  });

  it('keeps the head and the selection pointer intact when truncating a giant note', () => {
    const huge = 'x'.repeat(5000);
    const caption = composeCaption({ ...base, note: huge, selection: 'a notable quote' });
    expect(caption.length).toBeLessThanOrEqual(CAPTION_LIMIT);
    expect(caption).toContain('selection-hello-world.txt');
    expect(caption).toContain('…');
  });
});

describe('composePageDocument', () => {
  it('produces a standalone HTML document with title, url, and body inline', () => {
    const doc = composePageDocument(base);
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('<title>Hello, world</title>');
    expect(doc).toContain('<h1>Hello, world</h1>');
    expect(doc).toContain('href="https://example.com/post"');
    expect(doc).toContain('<p>first paragraph</p>');
    expect(doc.trim().endsWith('</html>')).toBe(true);
  });

  it('carries a machine-readable role marker for the page', () => {
    const doc = composePageDocument(base);
    expect(doc).toContain('<meta name="x-dispatch-role" content="page">');
    expect(doc).toContain('source: browser (role: page)');
  });

  it('includes the note as its own section when present', () => {
    const doc = composePageDocument({ ...base, note: 'worth re-reading' });
    expect(doc).toContain('<h2>Note</h2>');
    expect(doc).toContain('worth re-reading');
  });

  it('never embeds the selection — that ships as a separate file', () => {
    const doc = composePageDocument({ ...base, selection: 'a notable quote' });
    expect(doc).not.toContain('<h2>Selection</h2>');
    expect(doc).not.toContain('a notable quote');
  });

  it('omits the note section when absent', () => {
    const doc = composePageDocument(base);
    expect(doc).not.toContain('<h2>Note</h2>');
  });

  it('escapes HTML metacharacters in title, url, and note', () => {
    const doc = composePageDocument({
      url: 'https://example.com/?q=<script>',
      title: 'Tom & Jerry <evil>',
      bodyHtml: '<p>raw body kept as-is</p>',
      note: 'note with <b>tags</b>',
    });
    expect(doc).toContain('<title>Tom &amp; Jerry &lt;evil&gt;</title>');
    expect(doc).toContain('href="https://example.com/?q=&lt;script&gt;"');
    expect(doc).toContain('note with &lt;b&gt;tags&lt;/b&gt;');
    // bodyHtml is intentionally NOT escaped — it's the captured page markup.
    expect(doc).toContain('<p>raw body kept as-is</p>');
  });
});

describe('composeSelectionDocument', () => {
  it('is a plain-text file carrying the full highlight, role, and context', () => {
    const doc = composeSelectionDocument({ ...base, selection: 'a notable quote\nover two lines' });
    expect(doc).toBe(
      [
        'source: browser',
        'role: selection',
        'title: Hello, world',
        'url: https://example.com/post',
        '',
        'a notable quote\nover two lines',
      ].join('\n'),
    );
  });

  it('does not escape the selection — it is plain text, not markup', () => {
    const doc = composeSelectionDocument({ ...base, selection: '1 < 2 && 3 > 2' });
    expect(doc).toContain('1 < 2 && 3 > 2');
  });
});

describe('composeSelectionCaption', () => {
  it('labels the selection file clearly with the source + role marker', () => {
    const caption = composeSelectionCaption({ ...base, selection: 'x' });
    expect(caption).toContain('source: browser');
    expect(caption).toContain('role: selection');
  });

  it('describes what the file is and points back to the page file', () => {
    const caption = composeSelectionCaption({ ...base, selection: 'x' });
    expect(caption).toContain('exact text the user highlighted');
    expect(caption).toContain('page-hello-world.html');
  });
});

describe('filenames', () => {
  it('prefixes the slugified title with the file role', () => {
    expect(pageFilename(base)).toBe('page-hello-world.html');
    expect(selectionFilename(base)).toBe('selection-hello-world.txt');
  });

  it('falls back to a bare role name when the title slugifies to nothing', () => {
    expect(pageFilename({ ...base, title: '!!!' })).toBe('page.html');
    expect(selectionFilename({ ...base, title: '!!!' })).toBe('selection.txt');
  });
});
