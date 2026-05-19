// Heavyweight extractor (Readability + Turndown). Injected on user gesture
// via chrome.scripting.executeScript; the service worker reads
// __nanoDispatchResult in a follow-up func-based executeScript call.

import { extract } from '../capture/extract.js';

type ResultGlobal = typeof globalThis & { __nanoDispatchResult?: unknown };

(globalThis as ResultGlobal).__nanoDispatchResult = extract(
  document,
  location,
  window.getSelection()?.toString() ?? '',
);
