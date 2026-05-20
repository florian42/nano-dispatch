# ADR-0008: Switch from Bot API to MTProto user-account dispatch

Status: Accepted
Date: 2026-05-19

## Context

PRD §User Stories #25 says the bot's chat is consumed by an LLM agent
(`nanoclaw`) that should react to dispatched messages. The original
implementation called the Telegram Bot API (`sendDocument` with the bot
token), which has a fundamental constraint: **bots never receive
`update.message` events for messages they themselves sent.** With the
extension acting as the bot, every dispatch arrives in the chat as
authored by the bot, so the bot's update pipeline doesn't fire and the
agent has nothing to react to.

The Bot API has no "send as user" primitive. The only way to deliver an
inbound user message to the bot is to send it via Telegram's Client API
(MTProto) using a user-account session.

## Decision

Switch the dispatcher from Bot API to MTProto. The extension now
authenticates as the user's own Telegram account (phone + login code +
optional 2FA password), saves a session string, and sends messages as
the user *to* the bot rather than as the bot to the user.

Concrete shape:

- **Config** changes from `{ botToken, chatId }` to
  `{ apiId, apiHash, session, peer }`. `apiId`/`apiHash` come from
  `my.telegram.org/apps`; `session` is a GramJS `StringSession` save;
  `peer` is the bot's username or numeric ID.
- **Options page** gains a phone → code → 2FA auth flow that produces
  the session string. No more "paste a bot token" UX.
- **Dispatcher** is unchanged in spirit (composes a caption + HTML
  document, sends one message, returns mapped errors) but uses a
  `Sender` port instead of `fetch` — see ADR-0010.
- **MTProto library**: GramJS — see ADR-0009.
- **Build**: requires bundling — see ADR-0011.

## Consequences

### What this reverses in the PRD

- **PRD §Out of Scope, line 191** ("Authentication beyond the Telegram
  bot token") is reversed. Phone-based MTProto authentication is now
  in scope. The line is updated to reflect this.
- **PRD §Implementation Decisions / Configuration & secrets** is
  reworded for session-string storage instead of bot-token storage.
- **PRD §Permissions** host_permissions changes from
  `https://api.telegram.org/*` to `https://*.web.telegram.org/*` and
  `wss://*.web.telegram.org/*`. CSP `connect-src` adds the same.

### Threat-model delta vs. the previous bot-token storage

`docs/telegram-dispatch.md` §6 was scoped to the bot-token threat model.
The session string carries a strictly larger blast radius:

- A leaked bot token allowed sending to chats the bot is in and
  reading messages addressed to the bot. A leaked session string
  allows **reading all DMs** the user has, posting **as the user** in
  every chat they're in, and joining/leaving groups.
- Telegram's revocation tool for a session string is "Active Sessions"
  in the user's Telegram client, not @BotFather. The Sign-out button
  in the Options page calls `chrome.storage.local.remove('session')`
  locally; if the user suspects leakage they should *also* terminate
  the session from another Telegram client.
- Storage location is unchanged (`chrome.storage.local`). The same
  trade-off applies: anyone with read access to the Chrome profile
  directory can already read saved passwords, cookies, and session
  tokens — the session string adds to that pool but does not change
  its character.

### What we lose

- **Simplicity of the auth UX.** Pasting a bot token took 5 seconds.
  Phone → SMS code → maybe 2FA takes 30 seconds and assumes the user
  has Telegram open on another device.
- **Bundle size.** GramJS is ~1.3 MB unminified per surface that
  imports it (service worker, options page).
- **Send-only invariant.** A session string can read all of the user's
  DMs. We're trusting the extension code (and its dependencies) not
  to. The dispatch path is the only place that calls GramJS; any
  future code path that does so must be reviewed against this
  invariant.
- **Cold-start latency.** Each `dispatch()` builds a fresh
  `TelegramClient`, performs the DH handshake, syncs state, sends, and
  disconnects — ~1–2 s of MTProto setup on the first send after the SW
  wakes. Subsequent sends in the same SW lifecycle reuse some cached
  state and are faster, but the SW dies after 30 s of idle and evicts
  it. Stage 2's offscreen-document persistent client would hold the
  connection open and amortise the cost. This is the accepted stage-1
  trade-off in exchange for keeping the SW state-free.

### What we gain

- The bot receives normal `update.message` events for every dispatch.
  The LLM agent can react to them, including auto-replying back to
  the user — turning the chat into a real conversation.
- A foundation for future stages (read replies inline, full sidebar
  Telegram client) that would have been impossible on top of the Bot
  API regardless of effort.

## Alternatives considered

- **Tiny userbot relay** (a small script the user runs at home that
  listens on a private channel posted to by the bot, then re-posts
  to the agent's chat as the user account). Reintroduces an external
  service to operate, which PRD §Further Notes line 201 explicitly
  rules out as the central infra constraint. Rejected.
- **Two bots, one watches the other.** Telegram explicitly blocks
  bot-to-bot message visibility precisely to prevent feedback loops.
  Not an option.
- **Stay on Bot API, accept that the agent can never react.** Defeats
  PRD User Story #25's premise (the agent consumes the chat).
