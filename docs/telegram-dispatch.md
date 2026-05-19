# Telegram dispatch — protocol & security

Companion to `PRD.md`. The PRD is the *what*; this doc is the *how* for the
Telegram dispatch path — the only place in the extension where the bot token
lives, is read, and is used. Security invariants and protocol details live
together here on purpose: future readers see the constraints right where they'd
be tempted to violate them.

> Status: draft. Sections marked **[from sending thread]** are placeholders for
> the parallel discussion about how we send to Telegram and should be filled in
> as those decisions land.

---

## 1. Scope

This document covers:

- The dispatcher module's public contract.
- Message composition, splitting, and error mapping.
- How the bot token is stored, accessed, and protected.
- Cross-cutting extension security invariants that any module touching the
  token (or the user's selection) must uphold.

It does **not** cover the side-panel UI, the content-script extractor, or
service-worker plumbing beyond what's needed to keep the token safe.

---

## 2. Dispatcher contract

Single entry point:

```ts
dispatch(payload, config): Promise<DispatchResult>

payload: { url: string, title: string, selection?: string, note?: string, bodyMarkdown: string }
config:  { botToken: string, chatId: string }

DispatchResult =
  | { ok: true,  messageIds: number[] }
  | { ok: false, reason: 'unauthorized' | 'bad_chat' | 'network' | 'rate_limited' | 'unknown', detail: string }
```

Responsibilities: compose the message body, split on the 4096-character limit,
call `api.telegram.org/bot<token>/sendMessage`, normalize errors. Zero DOM,
zero `chrome.*` — just `fetch` and plain data. Lives in its own file so it
can be unit-tested under Node/Vitest.

The dispatcher is **only** ever invoked from the service worker. Never from a
content script. See §6.

---

## 3. Message composition

The body is Markdown, sent **without** `parse_mode` set — Telegram treats it as
plain text and does not attempt to render or validate the Markdown. The
consumer of the bot's chat is an LLM agent; Telegram is just the transport.
This sidesteps Telegram's MarkdownV2 escaping rules entirely.

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
<bodyMarkdown>
```

- The first line is a fixed `source: browser` tag — a machine-readable marker
  the downstream agent keys off to recognise browser-originated dispatches.
- `## Selection` and `## Note` sections are omitted entirely when their content
  is empty (not rendered as empty headers).
- `## Page` is always present when `bodyMarkdown` is non-empty.

## 4. Splitting

If the assembled body exceeds **4096 characters** (Telegram's per-message
limit), the dispatcher splits **section-anchored**:

- **Part 1** always carries: `source: browser`, the `(n/N)` marker (when
  N ≥ 2), the `# <title>` line, the `<url>` line, the full `## Selection`
  section (if present), the full `## Note` section (if present), and as much
  of `## Page` as fits within the part-1 budget.
- **Parts 2..N** are pure `## Page` continuation. The structural sections
  (`## Selection`, `## Note`) are **not** repeated on later parts — they
  belong to part 1's structural frame.

Rules:

1. Per-part header budget is fixed at **64 chars** (`source: browser\n(n/N)\n\n`
   even at N=99 fits comfortably). Effective body budget per part = **4032**.
2. Prefer splitting on paragraph boundaries (blank lines) within `## Page`.
3. Fall back to character boundaries if a single paragraph exceeds the
   budget.
4. The `source: browser` tag is repeated on every part so each chunk is
   independently identifiable in the chat.
5. The `(n/N)` marker appears **only when N ≥ 2**. Single-part sends do not
   carry it.
6. **No trailing `(end)` marker.** `(n/N)` with `n == N` already signals the
   last part; a redundant marker adds noise.

Parts are sent **sequentially**, not in parallel — order matters for the
reader, and Telegram's rate limits are friendlier to serial sends.

**Degenerate case:** if the headers + Selection + Note alone exceed the
part-1 budget (e.g. a 5000-char user selection), the Selection or Note
sections themselves may split across parts. This is rare; the dispatcher
does the simplest possible character-boundary split rather than refusing.
"Weird input, weird output, still arrives" is the chosen behaviour.

---

## 5. Error mapping

Telegram API errors are normalised to the discriminants in §2:

| HTTP / condition                          | `reason`         | Notes                                           |
| ----------------------------------------- | ---------------- | ----------------------------------------------- |
| `401 Unauthorized`                        | `unauthorized`   | Bad bot token. Surface "check options" in UI.   |
| `400` with `chat not found` in `description` | `bad_chat`    | Wrong chat ID, or bot not in chat.              |
| `429 Too Many Requests`                   | `rate_limited`   | Include `retry_after` from response in `detail`.|
| `fetch` rejects (network down, DNS, etc.) | `network`        |                                                 |
| Anything else                             | `unknown`        | Stuff the raw `description` in `detail`.        |

On **partial-success splits** (part 1 sent, part 2 fails): the PRD's "no retry
queue" decision applies. The dispatcher returns `{ ok: false, reason, detail }`
where:

- `reason` is the discriminant from the **failing** part's response (e.g.
  `rate_limited` if part 2 hit a 429).
- `detail` is a structured string of the form
  `"sent message_ids: [id1, id2]; failed at part 3/7: <description>"`.
  This gives the user enough information to recover manually (they know
  which parts landed and where to resume if they retry).

The dispatcher does **not** auto-retry rate-limited sends in v1, nor does it
throttle the inter-part interval pre-emptively — `rate_limited` is surfaced
honestly. If the user is regularly hitting it on long articles, the answer is
shorter articles or a future v2 throttle option, not silent backoff that
delays user feedback.

Draft is preserved either way (PRD user story #21).

---

## 6. Token handling

### 6.1 Threat model

A leaked bot token gives an attacker full impersonation via the Bot API:

- Send arbitrary messages to every chat the bot is in.
- Read DMs to the bot and messages in groups it has access to.
- For nano-dispatch specifically: inject crafted "dispatches" into the
  downstream LLM agent (`nanoclaw`). The token is therefore not only a
  credential but also a **prompt-injection vector** into the agent.

Telegram has no token disable — only rotation via `/revoke` in @BotFather.
Rotation is the kill switch.

### 6.2 Storage choice: `chrome.storage.local`

- **Not `chrome.storage.sync`** — would replicate the token through Google's
  servers to every Chrome profile signed in to the same Google account.
  Chrome's own docs: "local and sync storage areas should not store
  confidential user data because they are not encrypted."
- **Not `chrome.storage.session`** — in-memory only; would force the user to
  re-paste the token after every browser restart. Kills PRD user story #17
  ("paste once").
- **`chrome.storage.local`** is unencrypted on disk inside the user's Chrome
  profile. Accepted trade-off: an attacker who can read the profile directory
  can already read saved passwords, cookies, and session tokens — the
  marginal exposure of the bot token is small *given the rest of the threat
  model on the same machine*. We don't have an OS-keychain option from an
  extension.

### 6.3 Module-isolation invariants

These are hard rules. Any change that violates them is a security regression.

1. **The token is read only from the service worker.** The side-panel UI and
   options page may *write* the token (via the settings store wrapper); only
   the service worker may *read* it for dispatch.
2. **The content script never sees the token.** The content script returns
   `{ url, title, selection, bodyMarkdown }` to the service worker. The
   service worker reads the token from storage and calls Telegram. There must
   be no import path from the content-script bundle to the settings store.
3. **The token never appears in a `chrome.runtime.sendMessage` payload to or
   from a content script.** This follows from #2 but is worth stating: even
   passing the token through the service worker into a content-script call
   is forbidden.
4. **The token is never logged.** Not in `console.log`, not in error
   `detail` strings surfaced to the UI, not in any analytics. `unauthorized`
   as a discriminant is enough for the user to act.

### 6.4 Rotation / incident response

The options page should include a one-line note:

> If this token may have leaked, run `/revoke` in @BotFather to rotate it,
> then paste the new token here.

No automated rotation. No telemetry on token-related errors.

---

## 7. Cross-cutting extension security

Items that aren't strictly about the token but protect it (and the user's
data) in the same module.

### 7.1 Host permissions

Manifest `host_permissions`: **`https://api.telegram.org/*` only.** No
`<all_urls>`, no broader Telegram domains. `activeTab` + `scripting` cover
per-tab content access on user gesture.

Why this protects the token: a compromised content script cannot exfiltrate
the token to an attacker-controlled origin via the extension's fetch
permissions — the service worker's fetches are scoped to Telegram.

### 7.2 Content Security Policy

In `manifest.json`:

```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'"
}
```

No inline scripts. No remote scripts. Especially relevant in the side panel,
which renders user-typed notes and page selections.

### 7.3 Message-passing sender validation

Every `chrome.runtime.onMessage` handler in the service worker must validate:

```js
if (sender.id !== chrome.runtime.id) return; // reject silently
```

Blocks externally connectable extensions from impersonating the side panel
and triggering a dispatch.

### 7.4 DOM sanitisation in the side panel

The selection preview comes from the active page DOM and is therefore
attacker-influenceable (any page can put anything in `window.getSelection()`).
The side panel must render it via `textContent` / `.innerText` — never
`innerHTML`. Same rule for the page title and URL.

OWASP browser-extension cheat-sheet item: "Avoid using `eval()` and
`innerHTML` as they can execute malicious code."

### 7.5 Options UI

- Render the token field as `<input type="password">` with an optional
  "Reveal" toggle.
- Do not echo the token elsewhere in the UI (no "saved: 1234…abcd" preview).
- On dispatch errors, surface the `reason` discriminant, not the underlying
  Telegram response body.
- **"Test connection" button** is permitted and recommended. It calls
  `getMe` + `getChat` and displays only **public, API-derived** metadata —
  the bot's `username` (the `@handle`, already public) and the chat's
  `title` / `first_name`. It must never display, echo, or hint at the token.
  The verification panel renders separately from the token input to avoid
  any "saved-token confirmation" pattern.

---

## 8. Testing

The dispatcher and message-composer tests in PRD §Testing Decisions cover
the protocol side of this document. Security invariants (§6.3, §7.3, §7.4)
are architectural — enforced by where modules live and what they import, not
by runtime assertions. A lightweight CI check that greps the content-script
bundle for `chrome.storage` imports would catch most accidental regressions
on invariant #6.3.2.

---

## 9. Open questions / not yet decided

- Whether to retry transient `network` failures inside the dispatcher for the
  single-request (unsplit) case. The PRD's "no retry queue" decision points
  toward "no" here too — confirm explicitly when implementing.
- Optional v2: passphrase-derived AES-GCM encryption of the token via
  WebCrypto, prompted at first use per browser session. High UX cost; only
  worth it if the extension is ever published.

---

## References

- Chrome — [chrome.storage API reference](https://developer.chrome.com/docs/extensions/reference/api/storage)
- Chrome — [Stay secure](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure)
- OWASP — [Browser Extension Vulnerabilities Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html)
- GitGuardian — [Remediating Telegram Bot Token leaks](https://www.gitguardian.com/remediation/telegram-bot-token)
