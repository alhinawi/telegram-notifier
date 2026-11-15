# Security

## Trust boundary

Telegram Notifier sends information to Telegram using the configured bot. A bot token controls that bot and must remain secret. Use a dedicated personal bot, keep `.env` private, and rotate the token with BotFather if it was exposed. Never paste tokens into issues or attach state/config files to support reports.

Remote execution is disabled by default. When explicitly enabled, an allowed Telegram sender can invoke an AI CLI running as your local OS account. That CLI can have broad file access, network access, paid-provider credentials and tool permissions. This feature is not safe for untrusted senders. Workspace containment is not process isolation. The child does not inherit `TELEGRAM_BOT_TOKEN` from its environment, but it may still read local files if its account permits it.

Authorization checks include both chat and human sender ID. Groups need an explicit sender allowlist. Bots are rejected. Paths are realpath-checked against explicit roots before workspace selection. Prompt text is passed as a direct process argument with `shell: false`. Command-like text is not executed by a shell, but the AI agent's interpretation of a prompt still has the agent's own risks and limits.

## Limits

- Telegram messages and local state are not an end-to-end encrypted approval protocol.
- A local process that can alter your state files or environment can alter configuration or decisions. POSIX mode 0600 is not a defense against the same OS account.
- Approval records do not cryptographically bind a code diff. The consuming workflow must verify what was approved before acting.
- Token errors are redacted; avoid adding raw HTTP request/URL logging.
- The listener drops offline updates on startup to avoid accidental replay. It does not promise exactly-once execution across crashes.
- Duplicate sends cannot be ruled out by the network. The client does not retry ambiguous send failures.
- Windows process termination does not promise termination of all descendant processes. Use an OS sandbox for stronger isolation.
- OS background services are opt-in. Tests cover generated templates, not every host's service manager.

## Reporting a vulnerability

Do not publish credentials, exploit payloads against live recipients, or private logs. Share a minimal reproduction with placeholder values through GitHub's private vulnerability reporting if enabled. Otherwise contact the repository owner through their verified GitHub profile to arrange a private channel. No private reporting address is asserted by this repository.
