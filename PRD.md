# PRD — nano-dispatch Chrome Extension

A Chrome browser extension that dispatches the current page's context plus a personal note to a Telegram bot (`nanoclaw`) from a sidebar UI. One-way send only.

> ADRs in `docs/adr/` carry the historical record of decisions taken
> after this PRD was drafted (raw HTML capture, simplified splitter,
> dropped per-tab draft persistence, dropped live selection streaming,
> dropped options Test-connection button). The PRD below reflects the
> as-built shape.

## Problem Statement

When I'm reading something in the browser — an article, a docs page, a thread — and I want to capture it for later or hand it off to my `nanoclaw` Telegram bot, my current options are clumsy: copy-paste the URL, copy-paste the relevant selection, type a note in Telegram, switch apps. The friction means I either don't capture things or I capture them with missing context (no source URL, no surrounding paragraph). I want a one-keystroke way to ship "what I'm looking at + what I highlighted + what I want to say about it" into `nanoclaw`, without leaving the page.

## Solution

A Chrome extension that lives in the browser side panel. While I read, the sidebar shows:

- the page I'm on (title + URL),
- the current highlight (read once when the panel opens or when I switch tabs),
- a textarea for a note I write myself.

A "Send" button packages all three plus the page's HTML body into one Telegram message (split across messages if it exceeds 4096 chars) and pushes it to my `nanoclaw` bot. It's one-direction only: the extension sends, it does not read replies or listen for bot responses.

A small options page lets me paste my bot token and chat ID once.

## User Stories

1. As a reader, I want a sidebar that opens alongside the page I'm reading, so that I can compose and send a dispatch without leaving the page.
2. As a reader, I want the sidebar to always show the current tab's title and URL, so that I can confirm what's being sent.
3. As a reader, I want the sidebar to update its page context when I switch tabs, so that the dispatch always matches the page I'm looking at.
4. As a reader, I want the sidebar to read and display my current highlight when I open it or switch tabs, so that I can see what selection will be included before I send.
5. As a reader, I want a textarea where I can write a personal note, so that I can add commentary or instructions for myself in the Telegram message.
6. As a reader, I want a "Send" button that ships page title + URL + selection + my note to my Telegram bot in a single message, so that I get one self-contained record in my chat.
7. As a reader, I want the textarea to be cleared after a successful send, so that I can immediately compose another dispatch without manual cleanup.
8. As a reader, I want a visible status line (sending / sent / failed with reason), so that I know whether the dispatch actually made it.
9. As a reader, I want a keyboard shortcut to send (Cmd/Ctrl+Enter from the textarea), so that I can dispatch without reaching for the mouse.
10. As a reader, I want my in-progress note for each tab to stick around while the side panel stays open, so that I can switch tabs and come back without losing what I was typing. (Drafts live in memory only — closing the panel discards them.)
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
25. As a user whose Telegram bot is consumed by an LLM agent, I want every dispatch to carry a short machine-readable marker identifying it as having come from the browser extension, so that the agent can route or label browser-originated messages distinctly from other inputs to the bot.

## Implementation Decisions

> Telegram dispatch protocol details and token-handling security invariants
> live in [`docs/telegram-dispatch.md`](docs/telegram-dispatch.md). The notes
> below stay high-level; the companion doc is the source of truth for the
> dispatcher module.

### Architecture overview

Three runtime surfaces:

- **Side panel** (HTML/JS) — the user-facing UI rendered via Chrome's `chrome.sidePanel` API. Reads the current highlight via a one-shot `scripting.executeScript` on mount and on tab change.
- **Service worker** — orchestrates: receives "send" from the side panel, requests a capture from the active tab, hands the payload to the dispatcher, reports status back to the side panel.
- **Options page** — for bot token + chat ID configuration.

No always-on content script. Capture and selection reads both ride the user-gesture path via `activeTab` + `scripting.executeScript`.

### Modules

- **Telegram dispatcher** (deep). Single entry point `dispatch(payload, config)`:
  - `payload`: `{ url, title, bodyHtml, selection?, note? }`
  - `config`: `{ botToken, chatId }`
  - Returns a discriminated result: `{ ok: true, messageIds: number[] }` or `{ ok: false, reason: 'unauthorized' | 'bad_chat' | 'network' | 'rate_limited' | 'unknown', detail: string }`.
  - Responsible for: composing the message body, splitting on Telegram's 4096-character limit into multiple ordered messages, calling `api.telegram.org/bot<token>/sendMessage`, normalizing errors.
  - Zero DOM, zero chrome.* — just `fetch` + plain data. Lives in its own file so it can be unit-tested under Node/Vitest.

- **Page capture**. A 4-line inline `func` in the service worker, executed via `chrome.scripting.executeScript` on the active tab in response to Send. Returns `{ url, title, selection, bodyHtml: document.body.innerHTML }`. See ADR-0006 for why raw HTML and not Readability/Turndown Markdown.

- **Settings store**. Thin wrapper over `chrome.storage.local` exposing `getConfig()` / `setConfig()` returning/accepting `{ botToken, chatId }`. Validates non-empty strings.

- **Side panel UI**. Plain HTML + TypeScript (no React/Svelte/Preact). Responsibilities:
  - Subscribe to `chrome.tabs.onActivated` / `onUpdated` to refresh page context.
  - Render: page title, URL, selection preview, note textarea, Send button, status line.
  - Per-tab draft notes held in memory in the controller (`Map<tabId, string>`) for the lifetime of the panel. Switching tabs preserves each tab's draft; closing the panel discards everything. No `chrome.storage` involvement.
  - The selection chip is read once at panel mount and on every tab activation/update via a one-shot `scripting.executeScript` returning `window.getSelection().toString()`. If the user changes their selection while the panel is open and on the same tab, the chip will not update until the next tab change. Accepted trade-off (see ADR — selection streaming dropped).
  - Controller is tested against an in-process ports interface (`SidePanelPorts`) so the chrome.* surface can be stubbed; see ADR-0003.

- **Service worker**. Message broker only. Routes `{ type: 'send', tabId }` → capture → dispatcher → reply with status. No business logic of its own.

### Language

Strict TypeScript across every surface — dispatcher, service worker, side panel, options page, shared message types. `tsconfig.json` runs with `strict: true` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Types are taken seriously: the dispatcher's `DispatchResult` discriminant in `docs/telegram-dispatch.md` §2 is the compiled contract, not a doc-only convention. No `any`; if a value's shape genuinely isn't known, narrow at the boundary. Editor errors are a build break.

### Build

`tsc -p tsconfig.build.json` plus a few `cp`s, driven by `build.mjs` (~15 lines). One entry per surface (service worker, side panel, options page). No bundler. No minification — readable output is more valuable than a smaller bundle for a project this size. `manifest.json` is hand-written and copied verbatim into `dist/` by the build script.

### Message format (sent to Telegram)

The message body is Markdown-shaped, but sent **without** Telegram's `parse_mode` set — i.e. Telegram treats it as plain text and does not attempt to render or validate the Markdown. The agent consuming the bot's chat is the intended reader; Telegram is just the transport.

Layout:

```
source: browser

# <title>
<url>

## Selection
<selection text, or section omitted entirely if empty>

## Note
<user note, or section omitted entirely if empty>

## Page
<bodyHtml>
```

The first line is a fixed `source: browser` tag — a machine-readable marker the agent can key off to recognize browser-originated dispatches.

If the assembled body exceeds 4096 characters, the dispatcher strips the leading `source: browser\n\n` and chunks the remainder at paragraph (`\n\n`) or line (`\n`) boundaries with a 4032-char budget, then prepends `source: browser\n(n/N)\n\n` to each chunk. Paragraph boundaries are preferred but only honored when they sit in the upper half of the budget — otherwise the chunker hard-cuts at the budget to avoid wasting capacity. See ADR-0005 for the algorithm trade-off vs. a section-anchored splitter.

Parts are sent serially. On partial failure (part 1 sent, part 2 fails), the dispatcher returns `{ ok: false, reason, detail }` with the `message_id`s that did land listed in `detail`, and stops. No automatic retry, no rate-limit throttling — `rate_limited` is surfaced honestly to the user.

### Configuration & secrets

- Bot token + chat ID live in `chrome.storage.local` (not `sync` — credentials shouldn't ride along with browser sync).
- Options page is a separate HTML page reachable from the extension's action menu and via a "Configure" link in the side panel when config is missing.
- Save persists immediately. There is no in-options "Test connection" button — the dispatcher's first real send returns mapped errors (`unauthorized`, `bad_chat`, etc.) that surface in the side panel's status line. This is also the supported troubleshooting flow.

### Permissions (manifest v3)

- `sidePanel`, `storage`, `activeTab`, `scripting`, `tabs`.
- Host permissions: `https://api.telegram.org/*` only. No `<all_urls>` host permission. No `content_scripts` declaration — page reads (selection, body HTML) happen on user gesture via `activeTab` + `scripting`.

### Out-of-band decisions captured here

- Single recipient. The chat ID is configured once and used for every send. No per-message recipient picker in v1.
- No retry queue. A failed send shows an error; the user retries manually. Draft is preserved on failure.
- No history view inside the extension. Telegram is the log.

### Deferred

- **Restricted-page detection mechanism (US-23).** Whether the side panel detects `chrome://`, Web Store, PDF viewer, `file://` etc. via URL pattern, probe-and-fail, or a combination is not yet decided. For v1, the requirement is only that any failure path surfaces an error to the user in line with the security guidelines (no token in the message, clear reason discriminant from the dispatcher's enum, draft preserved). Settle the detection strategy when the side panel's tab-switch flow is implemented.

## Testing Decisions

Good tests here exercise external behavior (inputs → outputs, observable side effects) without coupling to implementation details like internal function names or DOM structure.

**In scope for tests:**

- **Telegram dispatcher** — the deep module. Vitest, with `fetch` stubbed. Cover:
  - Builds the expected request URL and JSON body for a typical payload.
  - Omits the selection block when no selection; omits the note block when no note.
  - Splits a >4096-char body into multiple ordered `sendMessage` calls with `(n/N)` prefixes.
  - Maps Telegram error responses (`401`, `400 chat not found`, `429`, network exception) to the documented `reason` discriminants.
  - Returns the array of returned `message_id`s on success.

- **Side-panel controller** — vitest + @testing-library/dom (jsdom env). See ADR-0003. Cover:
  - Mount renders the active tab's title/URL and the current selection in the chip.
  - Per-tab draft preserved when switching tabs (in memory); cleared on a successful Send.
  - Send happy path clears the textarea and shows "Sent (N messages)"; failure preserves textarea and surfaces `reason — detail`.
  - Missing-config gating; Cmd/Ctrl+Enter shortcut; options-link click; tab-update refresh.

- **Message composer** (sibling helper to the dispatcher). Vitest. Cover:
  - The first line of the composed body is exactly `source: browser`.
  - When the body is split across multiple messages, every part begins with `source: browser` followed by the `(n/N)` prefix.
  - Sections (`## Selection`, `## Note`) are omitted entirely when their content is empty; `## Page` is always present when `bodyHtml` is non-empty.

**Out of scope for tests:**

- Side panel DOM rendering. It's a shallow translation of state → DOM; integration value is low and maintenance cost is high.
- Service worker message routing. Mostly plumbing; covered implicitly by manual end-to-end use.
- Options page. Trivial form over `chrome.storage`.

## Out of Scope

- Receiving messages from the Telegram bot (one-way only by design).
- Multiple recipient bots/chats or per-message recipient selection.
- Telegram-side Markdown rendering (we send Markdown as plain text without `parse_mode`; the LLM agent is the reader, not Telegram's renderer).
- A persistent send history or queue in the extension.
- Automatic retry on failure.
- Firefox / Safari / Edge support. Chrome-only v1.
- Images, attachments, or non-text content from the page.
- Sending screenshots of the page.
- Authentication beyond the Telegram bot token.
- Syncing config across browsers.
- Live selection mirroring while the panel is open (dropped — see ADR).
- Persistent draft notes across panel close / browser restart (in-memory only).
- In-options "Test connection" verifier (dropped — real Send is the verifier).

## Further Notes

- Project naming: the working title and repo name is **nano-dispatch**. The user-facing extension name should also be "nano-dispatch" unless the user decides otherwise before publishing.
- The screenshot the user referenced (Claude.ai's right-hand sidebar with "Mention Tabs", selected text chip, and a "Write a message…" composer) is the visual reference for the side panel's shape and information density. Match that pattern: small header showing the source, a visible chip/block for the selection, a roomy composer, a single primary action.
- No backend. The extension talks directly to `api.telegram.org`. The Telegram bot token's exposure surface is the user's own browser profile; that's an accepted trade-off for the no-infra design.
