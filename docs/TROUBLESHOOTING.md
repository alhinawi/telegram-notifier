# Troubleshooting

## Setup returns without asking questions

The wizard intentionally requires an interactive terminal. CI should use environment secrets. Package installation never runs setup automatically.

## No update arrives

Run `npm run doctor`, then `npm run doctor -- --online`. Start the bot conversation in Telegram. Confirm the numeric chat ID belongs to the intended recipient. Try a short notification explicitly. `--dry-run` never sends. Check whether the recipient blocked the bot or the chosen forum topic is closed.

## Network or API errors

Requests have a 45-second deadline. Confirm outbound HTTPS to `api.telegram.org`. Invalid JSON responses are rejected without echoing their contents. Rate-limit responses are retried at most twice with delays capped at 60 seconds. If Telegram asks for a longer delay, the request fails rather than retrying early. Ambiguous send failures are not retried because they may already have delivered a message. Read retries are bounded.

## Telegram says conflict (409)

Another poller or webhook is attached to the bot. Stop the other process or deliberately remove its webhook through Telegram's API. The notifier never deletes a webhook silently. Read-only chat discovery should be run with the listener stopped too.

## Listener says another instance may be running

Inspect `~/.telegram-notifier/listener.lock` (or the configured state directory). A live PID blocks a second listener. A dead PID is reclaimed on startup. If the process ID belongs to an unrelated process after a reboot, verify it is not the listener before removing the lock manually. Never delete a lock just to bypass an active owner.

## A prompt does not run

Remote execution defaults to disabled. Set `ALLOW_REMOTE_EXECUTION=true` explicitly, then restart. Check the actual sender ID and `TELEGRAM_ALLOWED_USER_IDS` for groups. Queued prompts from before startup are discarded; send a new one. Confirm the CLI is installed and authenticated in the service account's PATH. Use an absolute executable path when PATH differs from your terminal.

## Directory unavailable

Add the intended root to `WORKSPACE_DIRS` locally. Symlink escapes, parent traversal outside a root, and ambiguous project names are not allowed. A workspace guard only limits selection: an AI CLI itself can still read or write other paths according to its normal privileges.

## Approval is pending

The listener and notifier must share the same state directory and account. Run the listener and click the current request's button. Buttons expire after one hour. Old v1 buttons, repeated clicks, mismatched messages, and unauthorized senders cannot change a decision. Read the result using `node scripts/approval.js ID`; this does not run any follow-up operation.

## Service does not start

Test `npm run daemon` in the foreground. Linux needs an active systemd user session; use `journalctl --user -u telegram-notifier.service`. macOS logs and the Windows Startup launcher write to `~/.telegram-notifier/logs`. On Windows the Startup launcher starts at the next login. Service commands are explicit local actions, not part of installation or tests.
