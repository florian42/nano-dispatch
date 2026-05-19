# ADR-0004: `disable_web_page_preview: true` on every `sendMessage`

Status: Accepted
Date: 2026-05-19

## Context

`docs/telegram-dispatch.md` §3 specifies the request body for
`sendMessage` only as carrying `chat_id` and `text` — `parse_mode` is
deliberately omitted. The page URL appears on its own line as the
second visible line of the message (just after `# <title>`).

By default Telegram detects URLs in plain-text messages and renders a
link-preview card below the message: it fetches the page, extracts
OpenGraph metadata, and shows a thumbnail. For this extension that
behaviour is wrong:

- The agent consuming the chat (`nanoclaw`) ignores preview cards;
  they're noise in its token stream.
- Telegram's preview fetch hits the source URL from Telegram's
  infrastructure, which is a privacy footgun the user didn't ask for
  (e.g. internal-only URLs touched by a third party).
- The preview also delays delivery by a few hundred ms while Telegram
  fetches the page.

## Decision

Every request body sent by the dispatcher includes
`disable_web_page_preview: true`:

```ts
JSON.stringify({
  chat_id: config.chatId,
  text,
  disable_web_page_preview: true,
})
```

## Consequences

- No preview card appears in Telegram for any dispatched message,
  including the first line's URL.
- A human reader of the chat sees the URL as plain text and can still
  tap it to navigate (Telegram's link detection is unchanged).
- The dispatcher test that asserts the request body shape (`tests/
  dispatcher/dispatch.test.ts`) pins this flag, so the behaviour is
  enforced by CI.

## Alternatives considered

- **Omit the flag (Telegram default = previews on)**: rejected for
  the reasons above.
- **Make it configurable in the options page**: premature — no user
  has asked for it and there's no UX win in showing a preview the
  bot's downstream consumer ignores.
