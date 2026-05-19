# PRD — nano-dispatch Chrome Extension

A Chrome browser extension that dispatches the current page's context plus a personal note to a Telegram bot (`nanoclaw`) from a sidebar UI. One-way send only.

## Problem Statement

When I'm reading something in the browser — an article, a docs page, a thread — and I want to capture it for later or hand it off to my `nanoclaw` Telegram bot, my current options are clumsy: copy-paste the URL, copy-paste the relevant selection, type a note in Telegram, switch apps. The friction means I either don't capture things or I capture them with missing context (no source URL, no surrounding paragraph). I want a one-keystroke way to ship "what I'm looking at + what I highlighted + what I want to say about it" into `nanoclaw`, without leaving the page.

## Solution

A Chrome extension that lives in the browser side panel. While I read, the sidebar continuously shows:

- the page I'm on (title + URL),
- whatever I've highlighted on the page,
- a textarea for a note I write myself.

A "Send" button packages all three into a single Telegram message and pushes it to my `nanoclaw` bot. It's one-direction only: the extension sends, it does not read replies or listen for bot responses.

A small options page lets me paste my bot token and chat ID once.

## User Stories

1. As a reader, I want a sidebar that opens alongside the page I'm reading, so that I can compose and send a dispatch without leaving the page.
2. As a reader, I want the sidebar to always show the current tab's title and URL, so that I can confirm what's being sent.
3. As a reader, I want the sidebar to update its page context when I switch tabs, so that the dispatch always matches the page I'm looking at.
4. As a reader, I want my current highlight on the page to appear in the sidebar in near-real time, so that I can see what selection will be included before I send.
5. As a reader, I want a textarea where I can write a personal note, so that I can add commentary or instructions for myself in the Telegram message.
6. As a reader, I want a "Send" button that ships page title + URL + selection + my note to my Telegram bot in a single message, so that I get one self-contained record in my chat.
7. As a reader, I want the textarea to be cleared after a successful send, so that I can immediately compose another dispatch without manual cleanup.
8. As a reader, I want a visible status line (sending / sent / failed with reason), so that I know whether the dispatch actually made it.
9. As a reader, I want a keyboard shortcut to send (Cmd/Ctrl+Enter from the textarea), so that I can dispatch without reaching for the mouse.
10. As a reader, I want the sidebar to remember my draft note per-tab while the tab is open, so that switching away and back doesn't lose what I was typing.
11. As a reader, I want to be able to send even without a highlighted selection, so that I can dispatch a page + note alone.
12. As a reader, I want to be able to send even without a note, so that I can dispatch just a page + selection when the highlight speaks for itself.
13. As a reader, I want long page content and long selections to be sent without being silently truncated, so that I don't lose information mid-message.
14. As a reader, I want messages that exceed Telegram's per-message size limit to be split into multiple ordered messages, so that everything arrives even when content is large.
15. As a reader, I want the source URL to appear as the first line of the dispatched message, so that I can tap it in Telegram to jump back to the source.
16. As a reader, I want the message formatted with clear sections (URL, selection, my note), so that it's scannable in the Telegram chat.
17. As a first-time user, I want a one-time options page where I paste my Telegram bot token and chat ID, so that I can set up the extension without editing code.
18. As a first-time user, I want the sidebar to nudge me to the options page when the bot token or chat ID is missing, so that I know why "Send" isn't working.
19. As a user concerned about credentials, I want my bot token stored only in the browser's local extension storage and never transmitted anywhere except `api.telegram.org`, so that my bot stays under my control.
20. As a user, I want the send action to fail loudly and clearly when Telegram rejects the request (bad token, wrong chat ID, network down), so that I'm not silently losing messages.
21. As a user, I want failed sends to leave my draft intact, so that I can fix the problem and retry without retyping.
22. As a user, I want the extension to work on standard `http(s)://` pages, so that any normal article or docs page is dispatchable.
23. As a user, I want a graceful "this page can't be captured" message on restricted pages (chrome://, web store, PDF viewer), so that I'm not confused when the sidebar can't read the page.
24. As a user, I want the extension to work without an external server — just the extension talking to Telegram directly — so that there's no infrastructure for me to operate.

## Implementation Decisions

### Architecture overview

Four runtime surfaces:

- **Side panel** (HTML/JS) — the user-facing UI rendered via Chrome's `chrome.sidePanel` API.
- **Content script** — injected into the active tab to observe the user's selection and extract the page's readable content on demand.
- **Service worker** — orchestrates: receives "send" from the side panel, requests a capture from the content script, hands the payload to the dispatcher, reports status back to the side panel.
- **Options page** — for bot token + chat ID configuration.

### Modules

- **Telegram dispatcher** (deep). Single entry point `dispatch(payload, config)`:
  - `payload`: `{ url, title, selection?, note? }`
  - `config`: `{ botToken, chatId }`
  - Returns a discriminated result: `{ ok: true, messageIds: number[] }` or `{ ok: false, reason: 'unauthorized' | 'bad_chat' | 'network' | 'rate_limited' | 'unknown', detail: string }`.
  - Responsible for: composing the message body, splitting on Telegram's 4096-character limit into multiple ordered messages, calling `api.telegram.org/bot<token>/sendMessage`, normalizing errors.
  - Zero DOM, zero chrome.* — just `fetch` + plain data. Lives in its own file so it can be unit-tested under Node/Vitest.

- **Page capture**. Single entry point `capture(tab)`:
  - Returns `{ url, title, selection, bodyText }`.
  - `selection` is whatever `window.getSelection().toString()` produces at capture time; empty string if none.
  - `bodyText` extraction starts simple: `document.body.innerText`, trimmed and collapsed. (Readability.js is a possible later upgrade; not in scope for v1.)
  - Pure with respect to a given DOM — testable with jsdom.

- **Settings store**. Thin wrapper over `chrome.storage.local` exposing `getConfig()` / `setConfig()` returning/accepting `{ botToken, chatId }`. Validates non-empty strings.

- **Side panel UI**. Plain HTML + a small amount of vanilla JS (or a minimal framework; Svelte/Preact are acceptable if the maintainer prefers, but no React+build-tool sprawl). Responsibilities:
  - Subscribe to `chrome.tabs.onActivated` / `onUpdated` to refresh page context.
  - Subscribe to a content-script message stream for live selection updates (debounced ~150 ms).
  - Render: page title, URL, selection preview, note textarea, Send button, status line.
  - Per-tab draft cache held in memory in the side panel for the lifetime of the panel.

- **Service worker**. Message broker only. Routes `{ type: 'send', tabId }` → capture → dispatcher → reply with status. No business logic of its own.

### Message format (sent to Telegram)

Plain text (no Markdown parse mode in v1 to avoid escaping bugs). Layout:

```
<title>
<url>

— Selection —
<selection text, or omitted entirely if empty>

— Note —
<user note, or omitted entirely if empty>
```

If the assembled body exceeds 4096 characters, the dispatcher splits on paragraph boundaries where possible, else on character boundaries, and prepends `(n/N)` to each part.

### Configuration & secrets

- Bot token + chat ID live in `chrome.storage.local` (not `sync` — credentials shouldn't ride along with browser sync).
- Options page is a separate HTML page reachable from the extension's action menu and via a "Configure" link in the side panel when config is missing.

### Permissions (manifest v3)

- `sidePanel`, `storage`, `activeTab`, `scripting`, `tabs`.
- Host permissions: `https://api.telegram.org/*` only. No broad `<all_urls>` host permission — `activeTab` + `scripting` covers per-tab content access on user gesture.

### Out-of-band decisions captured here

- Single recipient. The chat ID is configured once and used for every send. No per-message recipient picker in v1.
- No retry queue. A failed send shows an error; the user retries manually. Draft is preserved on failure.
- No history view inside the extension. Telegram is the log.

## Testing Decisions

Good tests here exercise external behavior (inputs → outputs, observable side effects) without coupling to implementation details like internal function names or DOM structure.

**In scope for tests:**

- **Telegram dispatcher** — the deep module. Vitest, with `fetch` stubbed. Cover:
  - Builds the expected request URL and JSON body for a typical payload.
  - Omits the selection block when no selection; omits the note block when no note.
  - Splits a >4096-char body into multiple ordered `sendMessage` calls with `(n/N)` prefixes.
  - Maps Telegram error responses (`401`, `400 chat not found`, `429`, network exception) to the documented `reason` discriminants.
  - Returns the array of returned `message_id`s on success.

- **Page capture extractor** — jsdom. Cover:
  - Extracts title, URL, and body text from a synthetic document.
  - Returns the current selection text when one exists, empty string otherwise.
  - Collapses runs of whitespace in body text.

**Out of scope for tests:**

- Side panel DOM rendering. It's a shallow translation of state → DOM; integration value is low and maintenance cost is high.
- Service worker message routing. Mostly plumbing; covered implicitly by manual end-to-end use.
- Options page. Trivial form over `chrome.storage`.

**Prior art:** none — empty repo. The dispatcher and extractor tests are greenfield; pattern after typical Vitest + jsdom setups.

## Out of Scope

- Receiving messages from the Telegram bot (one-way only by design).
- Multiple recipient bots/chats or per-message recipient selection.
- Markdown/HTML formatting in the Telegram message (plain text in v1).
- Readability-grade article extraction (basic `innerText` is enough for v1).
- A persistent send history or queue in the extension.
- Automatic retry on failure.
- Firefox / Safari / Edge support. Chrome-only v1.
- Images, attachments, or non-text content from the page.
- Sending screenshots of the page.
- Authentication beyond the Telegram bot token.
- Syncing config across browsers.

## Further Notes

- Project naming: the working title and repo name is **nano-dispatch**. The user-facing extension name should also be "nano-dispatch" unless the user decides otherwise before publishing.
- The screenshot the user referenced (Claude.ai's right-hand sidebar with "Mention Tabs", selected text chip, and a "Write a message…" composer) is the visual reference for the side panel's shape and information density. Match that pattern: small header showing the source, a visible chip/block for the selection, a roomy composer, a single primary action.
- No build pipeline is mandated. Plain JS in MV3 will work; a tiny bundler (esbuild/Vite) is acceptable if it makes the dispatcher's unit tests easier.
- No backend. The extension talks directly to `api.telegram.org`. The Telegram bot token's exposure surface is the user's own browser profile; that's an accepted trade-off for the no-infra design.
