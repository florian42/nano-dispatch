# nano-dispatch

A Chrome side-panel extension that ships the page you're reading — title, URL, your highlight, and a note you type — to a Telegram bot. One-way.

> **Status:** early prototype. PRD lives in [`PRD.md`](./PRD.md); see also [issue #1](https://github.com/florian42/nano-dispatch/issues/1).

---

## Scope — read this first

nano-dispatch is **deliberately narrow**. To keep it small, fast, and easy to reason about, the following are explicitly **in** and **out** of scope:

**In scope (v1)**

- A Chrome side-panel UI showing the current tab's title, URL, your current selection, and a textarea for a note.
- A "Send" action that bundles those four things into one Telegram message and pushes it to a single, pre-configured bot + chat.
- A one-time options page for the bot token and chat ID.
- Plain-text message format with automatic chunking on Telegram's 4096-char limit.

**Out of scope (won't be added)**

- **Receiving** messages from the bot — this extension is **send-only**. If you need two-way chat, use Telegram.
- Multiple recipients, per-message recipient picker, contact lists.
- Markdown/HTML rendering in the Telegram message (plain text only — avoids escaping bugs).
- A send history, queue, retry policy, or sync across browsers.
- Images, screenshots, file attachments, or non-text page content.
- Firefox, Safari, Edge, mobile. **Chrome desktop only.**
- A backend. The extension talks directly to `api.telegram.org`; there is no server to operate.

If a feature isn't on the "in scope" list, assume the answer is "no" until the PRD is updated.

---

## Screenshots

_TODO: add a GIF/screenshot of the side panel once the UI exists._

---

## Install

_TODO: link to the published extension or the unpacked-install instructions once there is a built artifact._

---

## Configuration

_TODO: document the options page — what to paste where, how to create a Telegram bot via `@BotFather`, how to obtain a chat ID._

---

## Usage

_TODO: write up the keyboard-driven send flow once it's implemented._

---

## Development setup

This section is the one you actually need today.

### Prerequisites

- **macOS or Linux.** Windows works under WSL; native Windows is untested.
- **git.**
- **[gitleaks](https://github.com/gitleaks/gitleaks)** — used by the secret-scanning hooks. Install via:
  ```sh
  brew install gitleaks                # macOS
  # or grab a binary from the gitleaks releases page on other platforms
  ```
- _(Build/test tooling for the extension itself will be documented once it lands.)_

### Clone & install hooks

```sh
git clone git@github.com:florian42/nano-dispatch.git
cd nano-dispatch
./hooks/install.sh
```

`hooks/install.sh` is idempotent and does three things:

1. Points this clone's git at the versioned hooks under [`hooks/`](./hooks) (`git config core.hooksPath hooks`).
2. Marks the hooks executable.
3. Verifies gitleaks is on `PATH` and warns loudly if it isn't.

Re-run it any time you suspect your local hook config has drifted.

### What the hooks do

Two hooks are installed and **must stay enabled**. They use [gitleaks](https://github.com/gitleaks/gitleaks) configured by [`.gitleaks.toml`](./.gitleaks.toml).

| Hook | When it runs | What it scans | What happens on a hit |
|---|---|---|---|
| `pre-commit` | Before every commit | The **staged diff** (`gitleaks git --staged`) | Commit blocked, secret value redacted in output |
| `pre-push` | Before every push | The **commit range** being pushed (`gitleaks git --log-opts=<remote>..<local>`) | Push blocked — defends against secrets that slipped past `pre-commit` (e.g. local-only commits made before the hook was installed) |

#### What gets caught

The ruleset extends gitleaks' built-in defaults with rules specifically for this project:

- **Telegram bot tokens** — `<numeric id>:<35-char secret>`.
- **Anthropic API / admin / session keys** — `sk-ant-api03-…`, `sk-ant-admin01-…`, `sk-ant-sid01-…`, plus a generic `sk-ant-<subtype>-…` fallback.
- **OpenAI / ChatGPT keys** — including legacy `sk-…T3BlbkFJ…` and the `sk-proj-` / `sk-svcacct-` / `sk-admin-` family.
- **Ollama tokens** — keyword-anchored bearer tokens.
- **Generic env-style assignments** — `(OPENAI|ANTHROPIC|CLAUDE|CHATGPT|OLLAMA|TELEGRAM)_(API_KEY|TOKEN|SECRET|BOT_TOKEN) = …` is caught even when the value doesn't match a format-specific rule, so format drift from providers still gets blocked.

Each rule is verified against realistic random fakes in CI before any release. Gitleaks' built-in **stopword** allowlist correctly ignores obvious placeholders like `abc…xyz` or `your-key-here`, so you can keep illustrative examples in docs without false positives.

#### `.gitignore` complements the hooks

[`.gitignore`](./.gitignore) blocks the most common secret-bearing files (`.env*`, `*.secret`, `*.pem`, `credentials.*`, `token.txt`, `chat-id.txt`, etc.) from ever being staged in the first place. The hooks are the second line of defence.

#### If you see "Commit BLOCKED"

1. **Read the gitleaks output above the banner.** It tells you which rule matched, which file, and which line.
2. **If it's a real secret:** rotate it, remove it from your working tree, and re-stage.
3. **If it's a false positive** (illustrative example in docs, a string that just happens to look like a token): add the path to the `[allowlist]` block in [`.gitleaks.toml`](./.gitleaks.toml). **Do not** bypass the hook for the commit.

#### Emergency bypass (basically don't)

```sh
SKIP_SECRET_SCAN=1 git commit ...
SKIP_SECRET_SCAN=1 git push ...
```

This exists for genuine emergencies (e.g. gitleaks itself is broken on your machine and you need to ship a fix). Using it for anything else is a bug; if you find yourself reaching for it, fix the rule or the `.gitleaks.toml` allowlist instead. Each use prints a loud warning.

> **Once a secret reaches the remote, consider it compromised.** Rotate it immediately — rewriting git history is a containment step, not a fix.

### Running gitleaks manually

Useful before you commit a big change:

```sh
# Scan everything in the working tree:
gitleaks dir .

# Scan all commits on the current branch that aren't on main yet:
gitleaks git --log-opts="main..HEAD"

# Scan just the staged diff (what the pre-commit hook does):
gitleaks git --staged
```

### Tests, lint, build

_TODO: fill in once the build tooling lands. Unit tests for the Telegram dispatcher and the page-capture extractor are planned; see the "Testing Decisions" section of the [PRD](./PRD.md)._

---

## Architecture

High-level shape (see [`PRD.md`](./PRD.md#implementation-decisions) for detail):

- **Telegram dispatcher** — pure module, no DOM, no `chrome.*`. Unit-tested.
- **Page capture** — extracts URL, title, body text, current selection from the active tab.
- **Settings store** — wraps `chrome.storage.local` for the bot token + chat ID.
- **Side panel UI** — Chrome's `chrome.sidePanel` surface.
- **Service worker** — message broker; no business logic of its own.

---

## Contributing

_TODO: write `CONTRIBUTING.md` once the project has a stable shape. Until then: open an issue, link the PRD, and we'll talk._

---

## License

_TODO: pick a licence (MIT / Apache-2.0 / etc.) and add `LICENSE`._

---

## Acknowledgements

Secret scanning is powered by [gitleaks](https://github.com/gitleaks/gitleaks).
