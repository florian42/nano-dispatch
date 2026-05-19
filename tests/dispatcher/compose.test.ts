import { describe, expect, it } from 'vitest';
import {
  composeCaption,
  composeDocument,
  documentFilename,
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
});

describe('composeDocument', () => {
  it('produces a standalone HTML document with title, url, and body inline', () => {
    const doc = composeDocument(base);
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('<title>Hello, world</title>');
    expect(doc).toContain('<h1>Hello, world</h1>');
    expect(doc).toContain('href="https://example.com/post"');
    expect(doc).toContain('<p>first paragraph</p>');
    expect(doc.trim().endsWith('</html>')).toBe(true);
  });

  it('includes selection and note as their own sections when present', () => {
    const doc = composeDocument({
      ...base,
      selection: 'a notable quote',
      note: 'worth re-reading',
    });
    expect(doc).toContain('<h2>Selection</h2>');
    expect(doc).toContain('<blockquote>a notable quote</blockquote>');
    expect(doc).toContain('<h2>Note</h2>');
    expect(doc).toContain('worth re-reading');
  });

  it('omits selection and note sections when absent', () => {
    const doc = composeDocument(base);
    expect(doc).not.toContain('<h2>Selection</h2>');
    expect(doc).not.toContain('<h2>Note</h2>');
  });

  it('escapes HTML metacharacters in title, url, selection, and note', () => {
    const doc = composeDocument({
      url: 'https://example.com/?q=<script>',
      title: 'Tom & Jerry <evil>',
      bodyHtml: '<p>raw body kept as-is</p>',
      selection: '1 < 2 && 3 > 2',
      note: 'note with "quotes"',
    });
    expect(doc).toContain('<title>Tom &amp; Jerry &lt;evil&gt;</title>');
    expect(doc).toContain('href="https://example.com/?q=&lt;script&gt;"');
    expect(doc).toContain('<blockquote>1 &lt; 2 &amp;&amp; 3 &gt; 2</blockquote>');
    // bodyHtml is intentionally NOT escaped — it's the captured page markup.
    expect(doc).toContain('<p>raw body kept as-is</p>');
  });
});

describe('documentFilename', () => {
  it('slugifies the title and uses an .html extension', () => {
    expect(documentFilename(base)).toBe('hello-world.html');
  });

  it('falls back to page.html when the title slugifies to nothing', () => {
    expect(documentFilename({ ...base, title: '!!!' })).toBe('page.html');
  });
});
