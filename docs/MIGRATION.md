# Upgrade from v1 to v2

This is a breaking security release. Back up `.env` and `~/.telegram-notifier` privately before updating. Never put their contents in Git.

1. Stop the old foreground listener or OS service before updating. Do not run two pollers with one bot.
2. Update your clone to the reviewed v2 commit with `git pull --ff-only`.
3. Run `npm ci --ignore-scripts`, `npm run check`, `npm test`, and `npm run doctor`.
4. Confirm the recipient and allowed workspace roots. Configuration uses the existing `.env` search locations. Saved language state remains supported. Old workspace-directory state is no longer used to expand access.
5. Prompt execution is now disabled. If wanted, explicitly set `ALLOW_REMOTE_EXECUTION=true` locally.
6. Convert a command such as `AI_AGENT_CLI=gemini --model example` to `AI_AGENT_CLI=gemini` with `AI_AGENT_ARGS=["--model","example"]`. Full executable paths with spaces are supported directly.
7. For group control, configure `TELEGRAM_ALLOWED_USER_IDS` with actual human sender IDs. A matching group chat ID alone is no longer sufficient.
8. Run the listener in the foreground first. Its startup deliberately discards queued updates. Existing approval buttons and project buttons from v1 do not carry valid v2 request state; send new ones.
9. Reinstall the service explicitly only if needed. Updating the repository does not update a separately installed global Gemini copy; rerun setup and choose that copy explicitly.

## Behavior changes

- No `postinstall` wizard, automatic notification, automatic daemon installation, or implicit remote execution.
- Messages are safe plain text rather than Markdown. Existing literal markup will appear literally.
- Approval buttons produce local, expiring records. They never automatically resume a process.
- `/cd` resolves relative to the active workspace and cannot escape configured roots, including via symlinks.
- Project buttons refer to saved paths rather than mutable list indexes.
- Project scanning no longer searches default home directories. Explicit `WORKSPACE_DIRS` wins; otherwise only the current directory is scanned.
- Discovery is read-only. It no longer silently changes the authorized recipient based on whoever most recently contacted the bot.
- Notifications split long text; output from remote tasks is capped at 64,000 characters per stream and summarized for Telegram.
- Use Node.js 20 or later.

## Rollback

Stop the v2 service, save its private configuration, and check out the pre-upgrade backup tag. Do not restore v1 remote execution on an exposed bot without understanding its shell-execution and authorization limitations. Rolling back code does not undo previously executed AI CLI changes. Use Git revert through a reviewed PR to undo repository changes without rewriting history.
