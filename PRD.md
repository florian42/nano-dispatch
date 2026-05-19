# PRD — nano-dispatch Chrome Extension

A Chrome browser extension that dispatches the current page's context plus a personal note to a Telegram bot (`nanoclaw`) from a sidebar UI. One-way send only.

> **Implementation status (2026-05-19).** As-built deviates from this PRD in
> one notable place: the Readability + Turndown extraction pipeline (User
> Stories #25 and #26, plus the Page Capture module) was dropped in favour
> of sending `document.body.innerHTML` verbatim. See
> [`docs/adr/0006-raw-html-capture.md`](docs/adr/0006-raw-html-capture.md)
> for the trade. Other ADRs in `docs/adr/` cover smaller divergences.
> User stories #25 and #26 below are kept as historical record of the
> original intent.

## Problem Statement

When I'm reading something in the browser — an article, a docs page, a thread — and I want to capture it for later or hand it off to my `nanoclaw` Telegram bot, my current options are clumsy: copy-paste the URL, copy-paste the relevant selection, type a note in Telegram, switch apps. The friction means I either don't capture things or I capture them with missing context (no source URL, no surrounding paragraph). I want a one-keystroke way to ship "what I'm looking at + what I highlighted + what I want to say about it" into `nanoclaw`, without leaving the page.

## Solution

A Chrome extension that lives in the browser side panel. While I read, the sidebar continuously shows:

- the page I'm on (title + URL),
- whatever I've highlighted on the page,
- a textarea for a note I write myself.

A "Send" button packages all three into a single Telegram message and pushes it to my `nanoclaw` bot. The page content is converted to Markdown (not raw HTML) before sending, so the downstream agent reading the message gets a token-efficient, well-structured representation instead of DOM noise. It's one-direction only: the extension sends, it does not read replies or listen for bot responses.

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
25. ~~As a user whose Telegram bot is consumed by an LLM agent, I want the page content sent as Markdown rather than HTML, so that the agent receives a compact, well-structured payload instead of paying token cost for tag soup.~~ *(Not implemented — see ADR-0006.)*
26. ~~As a user whose Telegram bot is consumed by an LLM agent, I want the page content stripped of boilerplate (nav, footers, ads, scripts) before conversion, so that the agent sees the article body and not the chrome around it.~~ *(Not implemented — see ADR-0006.)*
27. As a user whose Telegram bot is consumed by an LLM agent, I want every dispatch to carry a short machine-readable marker identifying it as having come from the browser extension, so that the agent can route or label browser-originated messages distinctly from other inputs to the bot.

## Implementation Decisions

> Telegram dispatch protocol details and token-handling security invariants
> live in [`docs/telegram-dispatch.md`](docs/telegram-dispatch.md). The notes
> below stay high-level; the companion doc is the source of truth for the
> dispatcher module.

### Architecture overview

Four runtime surfaces:

- **Side panel** (HTML/JS) — the user-facing UI rendered via Chrome's `chrome.sidePanel` API.
- **Selection-stream content script** — declared in `content_scripts`, runs automatically on every `http(s)` page. Top frame only. Does one thing: listens to `selectionchange` (debounced ~150 ms) and posts the current selection text to the side panel. No DOM mutation, no token access, no `fetch`. See "Selection streaming" below.
- **Capture content script** — heavier extractor (Readability + Turndown) injected on demand via `chrome.scripting.executeScript` when the user presses Send. Rides the user-gesture path; not always-on. *(Superseded by ADR-0006: capture is now a single inline `func` in the service worker that returns `document.body.innerHTML`. No separate capture content script.)*
- **Service worker** — orchestrates: receives "send" from the side panel, requests a capture from the active tab, hands the payload to the dispatcher, reports status back to the side panel.
- **Options page** — for bot token + chat ID configuration.

### Modules

- **Telegram dispatcher** (deep). Single entry point `dispatch(payload, config)`:
  - `payload`: `{ url, title, selection?, note? }`
  - `config`: `{ botToken, chatId }`
  - Returns a discriminated result: `{ ok: true, messageIds: number[] }` or `{ ok: false, reason: 'unauthorized' | 'bad_chat' | 'network' | 'rate_limited' | 'unknown', detail: string }`.
  - Responsible for: composing the message body, splitting on Telegram's 4096-character limit into multiple ordered messages, calling `api.telegram.org/bot<token>/sendMessage`, normalizing errors.
  - Zero DOM, zero chrome.* — just `fetch` + plain data. Lives in its own file so it can be unit-tested under Node/Vitest.

- **Page capture**. *(Section superseded by ADR-0006 — the as-built capture is a single inline `func` in the service worker returning `{ url, title, selection, bodyHtml: document.body.innerHTML }`. The Readability + Turndown pipeline below was the original plan and is preserved here as historical record.)*
  Fresh `scripting.executeScript` injection per Send — the capture bundle (Readability + Turndown + glue) is loaded into the tab only on user gesture, computes, returns its result as the last-evaluated value of `executeScript`, and is gone. No resident listener, no per-tab state to track across navigations or SW idle, no parsing cost on tabs the user never dispatches from. Single entry point `capture(tab)`:
  - Returns `{ url, title, selection, bodyMarkdown }`.
  - `selection` is whatever `window.getSelection().toString()` produces at capture time; empty string if none.
  - `bodyMarkdown` is produced by a two-stage pipeline:
    1. **Readability.js** (`@mozilla/readability`) runs against a clone of the document and returns the article's main content as a sanitized HTML fragment, stripping nav, footers, scripts, and other boilerplate.
    2. **Turndown** converts that HTML fragment to Markdown.
    - Fallback: if Readability returns null (page isn't article-shaped — e.g. an app dashboard, search results), feed `document.body.innerHTML` to Turndown directly. Last-resort fallback is `document.body.innerText` trimmed and collapsed.
  - Choosing Markdown over HTML is deliberate: the bot's consumer is an LLM agent, and Markdown is dramatically more token-efficient than HTML while preserving the structural cues (headings, lists, links, code blocks) the agent needs.
  - Pure with respect to a given DOM — testable with jsdom.

- **Settings store**. Thin wrapper over `chrome.storage.local` exposing `getConfig()` / `setConfig()` returning/accepting `{ botToken, chatId }`. Validates non-empty strings.

- **Side panel UI**. Plain HTML + TypeScript (no React/Svelte/Preact in v1 — keep the UI surface flat). Responsibilities:
  - Subscribe to `chrome.tabs.onActivated` / `onUpdated` to refresh page context.
  - Subscribe to a content-script message stream for live selection updates (debounced ~150 ms).
  - Render: page title, URL, selection preview, note textarea, Send button, status line.
  - Per-tab draft note persisted in `chrome.storage.session` keyed by `tabId`, written on textarea-change (debounced ~250 ms). Restored on side-panel open or tab switch. Cleared on successful send and on `chrome.tabs.onRemoved` (the SW owns the tab-close cleanup since the panel may not be open when the tab closes). Browser restart loses drafts by design — tabIds aren't stable across restarts and `chrome.storage.session` is wiped.
  - The selection chip is **not** persisted. On panel open or tab switch, the side panel re-queries the live page via a one-shot `scripting.executeScript` returning `window.getSelection().toString()`, then thereafter receives live updates from the always-on selection-stream script. Empty selection → empty chip; no stale-state caching.
  - Chip mirrors reality strictly: every `selectionchange` (including those that empty the selection) is reflected immediately. Accepted trade-off: an accidental click that clears the selection also clears the chip; the user may not notice and dispatch without their intended highlight. The PRD prefers honesty here over a sticky-chip workaround.

- **Service worker**. Message broker only. Routes `{ type: 'send', tabId }` → capture → dispatcher → reply with status. No business logic of its own.

### Language

Strict TypeScript across every surface — dispatcher, content scripts, service worker, side panel, options page, shared message types. `tsconfig.json` runs with `strict: true` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Types are taken seriously: the dispatcher's `DispatchResult` discriminant in `docs/telegram-dispatch.md` §2 is the compiled contract, not a doc-only convention. No `any`; if a value's shape genuinely isn't known, narrow at the boundary. Editor errors are a build break.

### Build

esbuild, driven by a hand-written `build.mjs` (~50 lines). One entry per surface (selection-stream content script, capture content script bundle, service worker, side panel, options page). **No minification** — readable output is more valuable than a smaller bundle for a project this size. Source maps on. Watch mode via `esbuild.context().watch()`; reload the unpacked extension by hand in `chrome://extensions`. `manifest.json` is hand-written and copied verbatim into `dist/` by the build script. No Vite, no CRXJS, no manifest generation. The dispatcher is bundle-free for Vitest — Vitest's own esbuild reads `.ts` directly.

### Selection streaming

The user story "highlight appears in the sidebar in near-real time" (US-4) conflicts with a pure `activeTab` permission model: `activeTab` grants per-tab access only after a user gesture and is revoked on navigation, so a content script that auto-listens to `selectionchange` across tab switches can't live there.

Resolution — **hybrid permissions**:

- **Always-on selection-stream content script** declared via a manifest `content_scripts` entry matching `http(s)://*/*`. Deliberately minimal: reads `window.getSelection().toString()` on `selectionchange`, debounces ~150 ms, calls `chrome.runtime.sendMessage` with `{ type: 'selection', text }`. Holds no token, performs no `fetch`, mutates no DOM. This is the only justification for the broad `http(s)` match — keep it that way.
- **Top frame only** (`all_frames: false`). Selections inside iframes (embedded gists, sandboxed widgets, post embeds) are accepted as a known gap. Rationale: every additional frame the script runs in is install-prompt and review surface; the minimalism is worth more than catching iframe selections.
- ~~**Heavy capture (Readability + Turndown)** is not always-on. It runs via `chrome.scripting.executeScript` on the active tab in response to the Send click — i.e., user-gesture path, no broad permission required for the extractor itself.~~ *(Superseded by ADR-0006: capture is a single inline `func` returning `document.body.innerHTML`, still user-gesture-only via `activeTab` + `scripting`.)*

The side panel is the listener for `{ type: 'selection', ... }` messages — it adds its own `chrome.runtime.onMessage` handler rather than relaying through the service worker. Reason: selection updates fire continuously during a drag and would otherwise resurrect the MV3 service worker for purely UI-bound traffic. Both the side panel and the service worker validate `sender.id === chrome.runtime.id` via a shared helper (see `docs/telegram-dispatch.md` §7.3).

### Message format (sent to Telegram)

The message body is Markdown, but sent **without** Telegram's `parse_mode` set — i.e. Telegram treats it as plain text and does not attempt to render or validate the Markdown. The agent consuming the bot's chat is the intended reader of the Markdown; Telegram is just the transport. This sidesteps Telegram's strict MarkdownV2 escaping rules entirely.

> *As-built (ADR-0006): the wrapper is still Markdown-shaped but the `## Page` section now contains raw `document.body.innerHTML` instead of a Markdown conversion. Field renamed `bodyMarkdown` → `bodyHtml`.*

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

The first line is a fixed `source: browser` tag. It's terse on purpose — a machine-readable marker the agent can key off to recognize browser-originated dispatches. A human skimming the chat sees it once and ignores it.

If the assembled body exceeds 4096 characters, the dispatcher splits **section-anchored**: part 1 always carries the headers + URL + `## Selection` + `## Note` + as much of `## Page` as fits; parts 2..N are pure `## Page` continuation (the structural sections don't repeat). Per-part header budget is fixed at 64 chars, leaving an effective body budget of 4032 per part. Paragraph boundaries preferred for the split point; character boundaries as fallback. The `source: browser` tag is repeated on every part. `(n/N)` is prepended only when N ≥ 2 (single-part sends stay clean). No trailing `(end)` marker — `(n/N)` already signals the last part.

Degenerate case: if the headers + Selection + Note alone exceed the part-1 budget (e.g. a 5000-char selection), the Selection or Note sections themselves are allowed to split across parts — accepted as rare and "weird input, weird output, still arrives."

Parts are sent serially. On partial failure (part 1 sent, part 2 fails), the dispatcher returns `{ ok: false, reason, detail }` with the `message_id`s that did land listed in `detail`, and stops. No automatic retry, no rate-limit throttling — `rate_limited` is surfaced honestly to the user.

### Configuration & secrets

- Bot token + chat ID live in `chrome.storage.local` (not `sync` — credentials shouldn't ride along with browser sync).
- Options page is a separate HTML page reachable from the extension's action menu and via a "Configure" link in the side panel when config is missing.
- **Validation is save-then-test, not save-time-blocking.** Save always persists (so the user can configure offline). A prominent "Test connection" button next to Save performs `getMe` + `getChat` on demand, surfacing the bot username and chat title on success ("✓ Verified — bot `@nanoclaw_bot`, chat 'Florian's Reading List'") or the same `reason` discriminant the dispatcher uses (`unauthorized`, `bad_chat`, `network`, `rate_limited`) on failure. The verification echo renders in its own panel of the options page — never adjacent to the token input, never showing the token itself, only public metadata (bot `username`, chat `title`/`first_name`). This double-duties as the troubleshooting affordance later: "Send fails → click Test" is the supported diagnostic flow.

### Permissions (manifest v3)

- `sidePanel`, `storage`, `activeTab`, `scripting`, `tabs`.
- Host permissions: `https://api.telegram.org/*` only. No `<all_urls>` host permission.
- `content_scripts` declaration: matches `http://*/*` + `https://*/*`, `all_frames: false`, restricted to the selection-stream script described under "Selection streaming". The heavier extractor uses `activeTab` + `scripting` on user gesture and is not declared in `content_scripts`.

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

- ~~**Page capture extractor** — jsdom. Cover:~~ *(Removed per ADR-0006 — there's no extractor to test; capture is a 4-line inline `func`.)*
  - ~~Extracts title, URL, and `bodyMarkdown` from a synthetic article-shaped document; the result is Markdown (has `#`/`##` headings, list syntax, link syntax — no raw HTML tags).~~
  - ~~Strips nav/footer/script boilerplate: a fixture with `<nav>`, `<script>`, and an article body produces Markdown containing only the article body.~~
  - ~~Falls back to a Turndown-of-`document.body` conversion when Readability returns null, and to `innerText` when even that yields nothing.~~
  - ~~Returns the current selection text when one exists, empty string otherwise.~~

- **Side-panel controller** — vitest + @testing-library/dom (jsdom env). *(Added beyond the original PRD; see ADR-0003.)* Cover:
  - Mount renders the active tab's title/URL and a "no selection" chip; live selection events from the current tab update the chip; events from other tabs are ignored.
  - Per-tab draft restored on mount; persisted after a 250 ms debounce on input; cleared on a successful Send.
  - Send happy path clears the textarea and shows "Sent (N messages)"; failure preserves textarea and surfaces `reason — detail`.
  - Missing-config gating; Cmd/Ctrl+Enter shortcut; options-link click; tab-update refresh.

- **Message composer** (part of the dispatcher or a sibling helper). Vitest. Cover:
  - The first line of the composed body is exactly `source: browser`.
  - When the body is split across multiple messages, every part begins with `source: browser` followed by the `(n/N)` prefix.
  - Sections (`## Selection`, `## Note`) are omitted entirely when their content is empty; `## Page` is always present when `bodyHtml` is non-empty.

**Out of scope for tests:**

- Side panel DOM rendering. It's a shallow translation of state → DOM; integration value is low and maintenance cost is high.
- Service worker message routing. Mostly plumbing; covered implicitly by manual end-to-end use.
- Options page. Trivial form over `chrome.storage`.

**Prior art:** none — empty repo. The dispatcher and extractor tests are greenfield; pattern after typical Vitest + jsdom setups.

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

## Further Notes

- Project naming: the working title and repo name is **nano-dispatch**. The user-facing extension name should also be "nano-dispatch" unless the user decides otherwise before publishing.
- The screenshot the user referenced (Claude.ai's right-hand sidebar with "Mention Tabs", selected text chip, and a "Write a message…" composer) is the visual reference for the side panel's shape and information density. Match that pattern: small header showing the source, a visible chip/block for the selection, a roomy composer, a single primary action.
- ~~A small bundler is now effectively required because the content script depends on `@mozilla/readability` and `turndown` from npm. esbuild or Vite is fine — pick whichever is least ceremony. The dispatcher remains pure JS with no bundling dependency.~~ *(Superseded by ADR-0006 — extraction pipeline dropped, so no bundler. Build is `tsc -p tsconfig.build.json` + three `cp`s.)*
- ~~The choice of `@mozilla/readability` + `turndown` is a Lindy bet: both libraries have years of production use (Readability powers Firefox's reader mode; Turndown is the de-facto HTML→Markdown converter in the JS ecosystem). Not researched against newer alternatives by design — the goal is a boring, durable extraction pipeline, not the optimum on a benchmark.~~ *(Superseded by ADR-0006 — those libraries are no longer used.)*
- No backend. The extension talks directly to `api.telegram.org`. The Telegram bot token's exposure surface is the user's own browser profile; that's an accepted trade-off for the no-infra design.
