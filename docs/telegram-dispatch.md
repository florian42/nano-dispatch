# Telegram dispatch — protocol & security

Companion to `PRD.md`. The PRD is the *what*; this doc is the *how* for the
Telegram dispatch path — the only place in the extension where the Telegram
session string lives, is read, and is used. Security invariants and protocol
details live together here on purpose: future readers see the constraints
right where they'd be tempted to violate them.

> **As-built note (2026-05-19).** The dispatcher was rewritten in
> [ADR-0008](adr/0008-mtproto-user-dispatch.md) to use MTProto user-account
> dispatch via [GramJS](adr/0009-gramjs-mtproto-library.md) instead of the
> Bot API. The transport seam is now the `Sender` port
> ([ADR-0010](adr/0010-dispatcher-sender-port.md)), the credential is a
> session string instead of a bot token, and the build is bundled with
> esbuild ([ADR-0011](adr/0011-esbuild-bundler.md)). Composition was
> reworked again in [ADR-0013](adr/0013-two-file-page-and-selection.md):
> the page and the selection now ship as two separate files in one media
> group rather than one HTML document with the selection baked in — see §3.

---

## 1. Scope

This document covers:

- The dispatcher module's public contract.
- Message composition, document attachment, and error mapping.
- How the Telegram session string is stored, accessed, and protected.
- Cross-cutting extension security invariants that any module touching the
  session (or the user's selection) must uphold.

It does **not** cover the side-panel UI, the content-script extractor, or
service-worker plumbing beyond what's needed to keep the token safe.

---

## 2. Dispatcher contract

Single entry point:

```ts
dispatch(payload, config, sender): Promise<DispatchResult>

payload: { url: string, title: string, selection?: string, note?: string, bodyHtml: string }
config:  { apiId: number, apiHash: string, session: string, peer: string }
sender:  Sender  // see ADR-0010

DispatchResult =
  | { ok: true,  messageIds: number[] }
  | { ok: false, reason: 'unauthorized' | 'bad_chat' | 'network' | 'rate_limited' | 'unknown' | 'no_access' | 'restricted_page', detail: string }
```

Responsibilities: compose the message as a caption plus one or two document
files, call `sender.sendDocuments(...)`, normalise errors. Zero DOM, zero
`chrome.*`, zero GramJS — just the `Sender` port and plain data. Lives in
its own file so it can be unit-tested under Node/Vitest.

The production `Sender` adapter (`src/dispatcher/gramjs-sender.ts`) wraps
GramJS's `TelegramClient.sendFile`. The adapter is the only file in the
extension that imports the `telegram` package.

The dispatcher is **only** ever invoked from the service worker. Never from a
content script. See §6.

---

## 3. Message composition

A dispatch is a **caption plus one or two document files**, sent as a single
Telegram media group (album). See [ADR-0013](adr/0013-two-file-page-and-selection.md)
for why the selection is its own file rather than baked into the page HTML.

Captions are sent **without** `parse_mode` set — Telegram treats them as
plain text and does not render or validate them. The consumer of the bot's
chat is an LLM agent; Telegram is just the transport. This sidesteps
MarkdownV2 escaping rules entirely.

### Files

| File                  | When            | MIME         | Contents                                                  |
| --------------------- | --------------- | ------------ | --------------------------------------------------------- |
| `page-<slug>.html`    | always          | `text/html`  | Standalone HTML doc: title, url, optional note, then raw `document.body.innerHTML` (ADR-0006). |
| `selection-<slug>.txt`| selection present | `text/plain` | The **full** highlighted text, with a `role: selection` header block. |

The filename prefix (`page-` / `selection-`) **and** an in-file role marker
both identify each file, so the agent never has to infer role from content:

- Page file: `<meta name="x-dispatch-role" content="page">` in `<head>` and a
  `source: browser (role: page)` line in the body header.
- Selection file: a header block before the highlight —

  ```
  source: browser
  role: selection
  title: <title>
  url: <url>

  <full selection text>
  ```

The selection is **never** duplicated into the page HTML. The note stays
inline in the page document (so a note too long for the caption survives in
full) and is also previewed in the caption.

### Captions

Each file in the album carries its own caption, shown beneath it. The caption
is what the downstream agent reads **first**, before opening any attachment, so
each one describes how the pieces relate. We *describe* the parts; we do not
*instruct* the agent what to do with them — that intent lives in the user's
note.

- **Page file caption** — the summary, leading with the machine-readable tag,
  and (when a highlight is present) a trailing line naming the selection file:

  ```
  source: browser

  <title>
  <url>

  <note, omitted when empty>

  — the user highlighted part of this page; the exact text is attached as selection-<slug>.txt
  ```

  The selection pointer line is present **only when a selection exists**. The
  note is truncated with `…` if the caption would exceed Telegram's
  **1024-char** caption limit; the head and the (small) selection pointer are
  kept intact and the note is trimmed to fit. The full note still lives in the
  page document.

- **Selection file caption** — describes the attached text and points back to
  the page file for context, so the agent knows this excerpt is the user's
  highlight and not the whole page:

  ```
  source: browser
  role: selection

  This file is the exact text the user highlighted on the page.
  The full page is page-<slug>.html; the user's note (if any) rides in that file's caption.
  ```

### Why no splitting

Earlier versions chunked a single composed body across many `sendMessage`
calls and tripped Telegram's per-chat rate limits on long pages. Sending the
page as a file attachment (and now the selection as a second file) removes
the size ceiling entirely: a media-group upload is **one** logical send
regardless of page or selection length, so there is no `(n/N)` chunking and
US-13 ("no silent truncation") holds for arbitrarily large content. ADR-0005
(the old splitter) is retained for history only.

---

## 5. Error mapping

The GramJS adapter surfaces RPC errors to the dispatcher as plain `Error`s
whose `message` is the bare TL error name. The dispatcher classifies:

| GramJS error message                              | `reason`         | Notes                                                              |
| ------------------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `AUTH_KEY_UNREGISTERED`                           | `unauthorized`   | Session string is invalid or revoked. Sign in again via Options.   |
| `PEER_ID_INVALID`                                 | `bad_chat`       | Recipient (peer) is wrong or the bot has been deleted.             |
| `FLOOD_WAIT_<n>`                                  | `rate_limited`   | `detail = "retry_after=<n>"`. No automatic backoff in stage 1.     |
| `NETWORK_ERROR: ...` (prefixed by adapter)        | `network`        | Adapter wraps transport-level failures (connect, socket, timeout). |
| Anything else                                     | `unknown`        | Original message preserved in `detail`.                            |

The adapter's contract is that classifiable RPC errors arrive as their bare
TL names (no `RPCError(420):` wrapping, no `[telegram]:` prefix). If a
future GramJS release changes the error shape, the adapter
(`src/dispatcher/gramjs-sender.ts`) is the only file that needs updating —
the dispatcher's `classify()` keeps working as long as it sees the bare
names.

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

## 6. Session handling

### 6.1 Threat model

A leaked Telegram **session string** gives an attacker full impersonation
of the user's Telegram account:

- Read all of the user's DMs (history + new messages).
- Post as the user in every chat they're in, including private groups.
- Add or remove the user from groups; join new ones.
- Read 2FA-protected message history (the session is post-2FA).
- For nano-dispatch specifically: also inject crafted "dispatches" into the
  downstream LLM agent (`nanoclaw`). The session is therefore both a
  credential and a **prompt-injection vector** into the agent — same as
  the bot token it replaced, but with a far larger account-impersonation
  blast radius.

The kill switch is Telegram's own "Active Sessions" UI (Settings → Devices
in any Telegram client). Clicking **Sign out** in the extension's Options
page only removes the session from `chrome.storage.local` — it does not
revoke the server-side record. After a suspected leak the user should do
**both**.

### 6.2 Storage choice: `chrome.storage.local`

Unchanged from the bot-token era:

- **Not `chrome.storage.sync`** — would replicate the session through
  Google's servers to every Chrome profile signed in to the same Google
  account. Chrome's own docs: "local and sync storage areas should not
  store confidential user data because they are not encrypted."
- **Not `chrome.storage.session`** — in-memory only; would force the user
  to re-authenticate after every browser restart.
- **`chrome.storage.local`** is unencrypted on disk inside the user's
  Chrome profile. Accepted trade-off: an attacker who can read the profile
  directory can already read saved passwords, cookies, and other session
  tokens — the Telegram session adds to that pool but doesn't change its
  character. We don't have an OS-keychain option from an extension.

### 6.3 Module-isolation invariants

These are hard rules. Any change that violates them is a security regression.

1. **The session is read only from the service worker** (for dispatch) **and
   the options page** (for sign-in/sign-out). The side-panel UI never reads
   it.
2. **The content script never sees the session.** The capture step (an
   inline `func` injected via `chrome.scripting.executeScript`) returns
   `{ url, title, selection, bodyHtml }` to the service worker. The
   service worker reads the session from storage and constructs the GramJS
   client. There must be no import path from the content-script bundle to
   the settings store.
3. **The session never appears in a `chrome.runtime.sendMessage` payload to
   or from a content script.** This follows from #2 but is worth stating.
4. **The session is never logged.** Not in `console.log`, not in error
   `detail` strings surfaced to the UI, not in any analytics. The
   `unauthorized` discriminant is enough for the user to act.
5. **GramJS is imported only by the production sender adapter and the
   options page auth flow.** The dispatcher core, the side panel, and the
   content-script capture path must remain GramJS-free.

### 6.4 Rotation / incident response

The Options page includes a one-line note:

> The extension stores your Telegram session string in local extension
> storage. Anyone with read access to this Chrome profile can read your
> DMs and post as you. If you suspect leakage, click **Sign out** and
> re-authenticate to invalidate the session.

For a confirmed leak the user must *also* terminate the session in
Telegram's own client (Settings → Devices → Terminate session). No
automated rotation. No telemetry on auth errors.

---

## 7. Cross-cutting extension security

Items that aren't strictly about the token but protect it (and the user's
data) in the same module.

### 7.1 Host permissions

Manifest `host_permissions`: **`https://*.web.telegram.org/*` and
`wss://*.web.telegram.org/*` only.** MTProto over WebSocket runs through
these endpoints. No `<all_urls>`, no broader Telegram domains.
`activeTab` + `scripting` cover per-tab content access on user gesture.

Why this protects the session: a compromised content script cannot
exfiltrate the session to an attacker-controlled origin via the
extension's fetch/WebSocket permissions — the service worker's network
surface is scoped to Telegram.

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

- Render the `api_hash` and 2FA password fields as `<input type="password">`.
- The session string is never displayed back to the user. The signed-in
  banner shows only "Signed in." plus a Sign-out button — no username,
  no preview.
- On dispatch errors, surface the `reason` discriminant, not the raw
  GramJS error message.
- No in-options "Test connection" verifier — the first real Send returns
  the same mapped `reason` discriminants and is the supported diagnostic
  path (ADR-0007).

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
- GramJS — [Project page](https://gram.js.org)
- Telegram — [Active Sessions / session termination](https://telegram.org/faq#q-i-have-questions-about-account-security)
