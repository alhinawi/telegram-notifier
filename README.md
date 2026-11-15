![Telegram Notifier: your work, your phone, your control](assets/banner.svg)

# Telegram Notifier

### Your work. Your phone. Your control.

Reliable task updates and an opt-in control bridge for AI coding agents.

**Zero runtime dependencies · English + Arabic · Node.js 20+ · MIT**

[Quick start](#quick-start) · [Notifications](#notifications) · [Remote control](#optional-remote-control) · [Upgrade from v1](docs/MIGRATION.md) · [Security](SECURITY.md)

---

Get a concise update when a build finishes. Review an approval request from your phone. When you choose, send your AI CLI a prompt from Telegram, switch projects, or stop a running task.

Version 2 fixes the control bridge's shell execution, setup hangs, nonfunctional approval handoff, stale project buttons, formatting failures, and unbounded network/process waits. Installation is now quiet and remote execution is **off by default**.

## What is included

| Capability            | What it does                                                                           |
| --------------------- | -------------------------------------------------------------------------------------- |
| Task updates          | Success, approval, error, info, and alert events, with English and Arabic templates    |
| Safe message delivery | Plain text, Unicode-safe splitting, silent mode, forum topics, file/stdin input        |
| Reliable transport    | Request deadlines, bounded read retries, Telegram rate-limit handling, redacted errors |
| Real decision records | Message-bound, single-use approval/rejection records with one-hour expiry              |
| Project control       | Stable project selection, relative `/cd`, file lists, language switching, task status  |
| Explicit execution    | Direct process arguments, one task at a time, bounded output, timeout, stop escalation |
| Local diagnostics     | Offline config checks and optional bot-identity verification, without sending messages |
| Test coverage         | Node's built-in test runner; CI across Node 20/22/24 and Linux/macOS/Windows           |

## Quick start

```bash
git clone https://github.com/alhinawi/telegram-notifier.git
cd telegram-notifier
npm ci --ignore-scripts
npm run setup
npm run doctor
```

Create a bot with Telegram's **@BotFather** before setup. The terminal wizard hides the token, verifies the bot, and can pair your private chat using a random `/start` challenge. Configuration is saved with owner-only file permissions on POSIX systems. Global plugin copying, a test message, remote execution, and service installation each require your choice.

For an agent skill description you can use:

```bash
npx skills add alhinawi/telegram-notifier
```

A skill install does not automatically run the runtime wizard or start a service. Ensure the scripts and locales are present, then run setup explicitly from the installed repository. No published npm registry package is required by the clone-based installation above.

### CI or manual configuration

Supply `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` through your CI secret store, or copy `.env.example` to `.env` locally. Never commit the filled file. `npm run doctor` reports only whether configuration is present, not its values.

## Notifications

```bash
node scripts/notify.js --type task_finished --project my-app \
  --message 'Summary: Fixed login validation. Validation: Tests passed. Status: Ready for review.'

node scripts/notify.js --type error --lang ar --message 'فشل البناء. راجع السجل المحلي.'

# Check the exact message without credentials, network traffic, or a send.
node scripts/notify.js --dry-run --title 'Release check' --message 'Ready for review.'

# Machine-readable message IDs, quiet delivery, and a forum topic.
node scripts/notify.js --type info --message 'Nightly build passed.' \
  --silent --thread-id 123 --json
```

For literal multiline input containing quotes, dollar signs, or backticks:

```bash
node scripts/notify.js --type info --message-file - <<'MESSAGE'
Build report
No shell expansion: $HOME, `code`, and $(commands) remain text.
MESSAGE
```

Types: `task_finished`, `approval_required`, `error`, `info`, `alert`. Common aliases such as `done`, `success`, `approval`, and `failed` remain supported. Unknown flags and event types fail clearly. Long messages are split safely below Telegram's size limit. Markdown-like text is delivered literally, so project names such as `my_app` do not break parsing.

Language precedence: `--lang`, saved `/language` preference, `NOTIFICATION_LANGUAGE`, English. Use `--no-buttons` for an informational approval event without decision buttons.

### Approvals that scripts can read

```bash
node scripts/notify.js --type approval_required \
  --message 'Approve deploying reviewed commit abc123?' --json
# Returns {"ok":true,"messageIds":[...],"approvalId":"..."}

node scripts/approval.js <approvalId>
# JSON status; exit 0 = approved, 2 = rejected, 3 = pending/expired/missing
```

Run `npm run daemon` to process clicks. The sending CLI does not wait. The workflow consuming the result decides whether to continue and must check its own action permissions. A button records a decision, not an automatic deployment. Decisions are chat/message-bound, expire in one hour while pending, and reject repeated or mismatched callbacks. Sender and listener must use the same local state directory.

## Optional remote control

Read-only bot commands and approval processing work without enabling prompt execution:

```bash
npm run daemon
```

If you want Telegram text to run your local AI CLI, set these locally and restart:

```dotenv
ALLOW_REMOTE_EXECUTION=true
WORKSPACE_DIRS=~/workspace,~/Projects
AI_AGENT_CLI=claude
AI_AGENT_ARGS=[]
TASK_TIMEOUT=600
```

`AI_AGENT_CLI` is an executable name or full path, not a shell command. Put additional arguments in the JSON array `AI_AGENT_ARGS`. Adapters cover Gemini/Claude/Antigravity (`-p`), Aider (`--message`), and Codex (`exec`). Other executables receive the prompt as their final argument. The selected CLI must already be installed, signed in, and able to run noninteractively.

| Command              | Behavior                                                                  |
| -------------------- | ------------------------------------------------------------------------- |
| `/projects`          | Recent projects inside configured roots; stable, single-selection buttons |
| `/cd <path or name>` | Switch within allowed roots; relative paths use the active project        |
| `/ls [path]`         | List non-hidden files and directories without leaving allowed roots       |
| `/dirs`              | Show configured scan roots                                                |
| `/language`          | Switch English/Arabic and the chat's command menu                         |
| `/status`            | Active project, language, execution setting, task status                  |
| `/stop`              | Request termination; force-kill after three seconds if needed             |
| `/help`              | Usage and current workspace                                               |

Only one task runs at a time. Polling stays responsive while it runs. Unknown slash commands do not become prompts. Old queued messages are discarded on fresh startup, so a stopped computer does not later execute a backlog of work. Use a dedicated bot: startup discards that bot's pending updates and only one poller can own it.

Private chats require both the configured chat ID and matching sender ID. Group control additionally requires `TELEGRAM_ALLOWED_USER_IDS=123,456`. Bot senders are rejected. These checks control who can request work; **they are not an OS sandbox**. The AI CLI retains its normal filesystem and account privileges. Keep remote execution disabled unless you understand that access.

### Background services

```bash
npm run service:install
npm run service:status
npm run service:restart
npm run service:uninstall
```

macOS uses a user launchd agent; Linux uses a systemd user service and needs a working user session. Windows installs a Startup launcher for the **next login**, not an immediate scheduled task. Windows uninstall removes that launcher but does not kill a listener already running. Use `/stop` for its task and close its process separately. OS service installation has not been exercised by the portable unit tests; templates and quoting are tested. Linux service logs are available through `journalctl --user -u telegram-notifier.service`; macOS and Windows use `~/.telegram-notifier/logs`.

## Configuration

| Variable                      | Default / purpose                                            |
| ----------------------------- | ------------------------------------------------------------ |
| `TELEGRAM_BOT_TOKEN`          | Required secret from BotFather                               |
| `TELEGRAM_CHAT_ID`            | Required numeric recipient ID                                |
| `NOTIFICATION_LANGUAGE`       | `en`; notification fallback language                         |
| `LISTENER_LANGUAGE`           | Optional control-language fallback                           |
| `WORKSPACE_DIRS`              | Comma-separated roots; current directory only when omitted   |
| `AI_AGENT_CLI`                | `gemini`; executable, never a shell expression               |
| `AI_AGENT_ARGS`               | `[]`; extra CLI arguments as a JSON string array             |
| `TASK_TIMEOUT`                | `600`; valid range 1..86400 seconds                          |
| `ALLOW_REMOTE_EXECUTION`      | `false`; set exactly `true` to enable                        |
| `TELEGRAM_ALLOWED_USER_IDS`   | Explicit sender IDs required for group control               |
| `MAX_UPDATE_AGE`              | `120`; ignore messages older than this many seconds          |
| `TELEGRAM_NOTIFIER_CONFIG`    | Optional explicit config file path                           |
| `TELEGRAM_NOTIFIER_STATE_DIR` | Default `~/.telegram-notifier`; approvals and listener state |

Precedence: process environment, explicit config, current-directory `.env`, repository `.env`, global Gemini plugin `.env`. An explicitly empty environment variable stays empty. Quoted values and `export KEY=value` are supported. State files contain workspace paths, language preferences and decisions, not bot tokens. Keep them private.

## Diagnostics and development

```bash
npm run doctor                 # Offline, no message sent
npm run doctor -- --online     # Verify bot identity with getMe, no message sent
npm run check                  # Check every JavaScript file's syntax
npm test                       # Regression and security tests; no Telegram account needed
npm run test:coverage
npm pack --dry-run             # Inspect distributable contents
```

No runtime dependencies. Tests use fake Telegram responses and temporary directories, plus real local child processes to check argument safety and timeouts. They never send real notifications, enable services, or run an AI provider.

See [migration notes](docs/MIGRATION.md), [troubleshooting](docs/TROUBLESHOOTING.md), [security](SECURITY.md), and [changes](CHANGELOG.md).

## License

MIT. Created by Mohamed Alhinawi.
