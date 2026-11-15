# Changelog

## 2.0.0

### Security and correctness

- Replace shell-based prompt execution with direct arguments and explicit remote-execution opt-in.
- Authenticate both chat and sender, require group sender allowlists, and reject bot senders.
- Confine workspace selection to explicit real paths and reject symlink escapes.
- Drop offline prompt backlog on startup; prevent competing local listener instances.
- Remove the automatic postinstall wizard and require consent for global copies, test sends and services.
- Save configuration and state atomically with private POSIX permissions.
- Make chat discovery read-only and wizard pairing challenge-based.
- Fix relative workspace resolution, language precedence, stale project selection, callback null handling, and locale path validation.
- Bound request time, retries and process output. Terminate timed-out tasks and keep `/stop` responsive.
- Deliver safe literal text, split long Unicode messages, and avoid logging bot tokens.

### Features

- Persistent, expiring approval/rejection results with a script-friendly status command.
- Offline diagnostics and optional bot-identity verification.
- Dry-run previews, JSON results, silent messages, forum-topic support, stdin/file message input.
- Importable notification, transport, control, setup and diagnostics modules.
- Extra agent arguments as JSON; explicit Codex support.
- Worktree-aware branch detection.
- Regression tests and a nine-cell Node/OS CI matrix.
- Migration, security, troubleshooting and configuration documentation.

### Breaking changes

Node.js 20+ is required. Remote execution is disabled by default. Plain-text messages replace implicit Markdown. Setup and services never start on installation. Workspace discovery no longer scans unrelated home directories. See `docs/MIGRATION.md`.
