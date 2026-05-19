import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { extract } from '../../src/capture/extract.js';

function dom(
  html: string,
  url = 'https://example.com/post',
): { doc: Document; location: { href: string } } {
  const { window } = new JSDOM(html, { url });
  return { doc: window.document, location: { href: url } };
}

describe('extract', () => {
  it('returns title, url, and markdown body for an article-shaped document', () => {
    const { doc, location } = dom(`<!doctype html><html><head><title>Hello world</title></head>
      <body>
        <article>
          <h1>Hello world</h1>
          <p>The first paragraph has enough text to satisfy Readability's heuristics. It includes several sentences explaining a thing.</p>
          <h2>A subheading</h2>
          <p>And another paragraph follows, which together with the first one exceeds Readability's minimum content threshold and gives a coherent article body.</p>
          <p>Even more content, because Readability really likes a lot of words before it commits to calling something an article.</p>
        </article>
      </body></html>`);

    const result = extract(doc, location, '');

    expect(result.url).toBe('https://example.com/post');
    expect(result.title).toBe('Hello world');
    expect(result.selection).toBe('');
    expect(result.bodyMarkdown).toContain('first paragraph');
    expect(result.bodyMarkdown).not.toMatch(/<\/?p>/);
  });

  it('strips nav, footer, script, and ad boilerplate from the extracted body', () => {
    const { doc, location } = dom(`<!doctype html><html><head><title>An article</title></head>
      <body>
        <nav><a href="/home">Home</a> | <a href="/about">About</a></nav>
        <script>window.__tracking = 'should-not-appear';</script>
        <main>
          <article>
            <h1>An article</h1>
            <p>The article body contains a unique sentinel string that must survive: ARTICLEBODYUNIQUE.</p>
            <p>Another sentence of supporting content so that Readability finds enough text here.</p>
            <p>Yet another supporting paragraph for the readability score.</p>
          </article>
        </main>
        <footer>copyright 2026 NOPE_FOOTER</footer>
      </body></html>`);

    const result = extract(doc, location, '');

    expect(result.bodyMarkdown).toContain('ARTICLEBODYUNIQUE');
    expect(result.bodyMarkdown).not.toContain('should-not-appear');
    expect(result.bodyMarkdown).not.toContain('NOPE_FOOTER');
    expect(result.bodyMarkdown).not.toContain('Home');
  });

  it('falls back to a Turndown-of-body conversion when Readability returns null', () => {
    const { doc, location } = dom(`<!doctype html><html><head><title>App</title></head>
      <body>
        <div id="root">
          <p>BODYFALLBACK</p>
        </div>
      </body></html>`);

    const result = extract(doc, location, '');
    expect(result.bodyMarkdown).toContain('BODYFALLBACK');
    expect(result.bodyMarkdown).not.toMatch(/<\/?p>/);
  });

  it('falls back to plain text when Turndown produces nothing useful', () => {
    const { doc, location } = dom(`<!doctype html><html><head><title>t</title></head>
      <body>   plaintext-only-no-tags   </body></html>`);

    const result = extract(doc, location, '');
    expect(result.bodyMarkdown).toBe('plaintext-only-no-tags');
  });

  it('returns the provided selection text verbatim', () => {
    const { doc, location } = dom(
      `<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>`,
    );
    const result = extract(doc, location, 'I highlighted this');
    expect(result.selection).toBe('I highlighted this');
  });
});
