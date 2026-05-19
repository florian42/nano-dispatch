import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

export type CaptureResult = {
  url: string;
  title: string;
  selection: string;
  bodyMarkdown: string;
};

export function extract(
  doc: Document,
  location: { href: string },
  selection: string,
): CaptureResult {
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

  const clone = doc.cloneNode(true) as Document;
  const article = new Readability(clone).parse();

  let bodyMarkdown = '';
  let title = doc.title;
  if (article?.content) {
    bodyMarkdown = turndown.turndown(article.content).trim();
    if (article.title) title = article.title;
  } else {
    const fallback = turndown.turndown(doc.body.innerHTML).trim();
    bodyMarkdown = fallback.length > 0 ? fallback : collapseWhitespace(doc.body.textContent);
  }

  return {
    url: location.href,
    title,
    selection,
    bodyMarkdown,
  };
}

function collapseWhitespace(s: string): string {
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
