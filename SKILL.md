---
name: telegram-notifier
description: Send Telegram task updates, request recorded human decisions, and optionally run an explicitly enabled, authenticated AI CLI control bridge.
---

# Telegram Notifier

Use this skill when the user requests Telegram updates or has already enabled notifications for the current workflow. A task completion is not permission to send its contents to Telegram. Share only the approved project information; never include credentials, private source code, or unrelated context.

## Setup

Requires Node.js 20 or later and the repository's `scripts/` and `locales/` directories.

- Run `node scripts/doctor.js` to check local configuration without network access.
- If credentials are missing, ask the user to run `node scripts/setup.js` in their terminal or configure environment variables locally. Never ask them to paste secrets into a conversation.
- Installing a skill description does not run setup, start services, or enable remote execution.
- Use paths relative to the installed repository, not an assumed current directory.

## Send updates

```bash
node scripts/notify.js --type task_finished --lang en --project my-project --message 'Summary: Fixed validation. Validation: 53 tests passed. Status: Ready for review.'
node scripts/notify.js --type error --message 'Build failed. Review the local logs.'
node scripts/notify.js --type approval_required --message 'Approve deployment of the reviewed commit?' --json
```

Prefer professional English for task-completion messages and concise Conventional Commit subjects for Git commits. Keep notifications factual: summary, validation, Git reference when available, and actual status. Never call a draft deployed or a button click an executed operation. Arabic notifications remain available with `--lang ar`.

For content containing shell characters, use `--message-file PATH` or pipe a quoted heredoc into `--message-file -`. Do not interpolate untrusted text into a shell command.

Preview without sending or credentials: `node scripts/notify.js --dry-run --message 'Preview'`.

## Decisions

`--type approval_required --json` returns an `approvalId`. The listener must be running to process the buttons. Read the result using `node scripts/approval.js <approvalId>`: exit 0 approved, 2 rejected, 3 pending/expired/missing. Requests expire after one hour. A decision is tied to its chat and message and cannot be reused. The notifier records decisions only; it never resumes a deployment, spends money, or executes a follow-up automatically. The caller must verify that the approval covers the actual proposed action before continuing.

## Optional remote control

Start the listener only when requested: `npm run daemon`. It supports `/projects`, `/cd`, `/ls`, `/dirs`, `/language`, `/status`, `/stop`, and `/help`. Read-only commands work by default. Plain-text prompts run the configured AI CLI only when the user locally sets `ALLOW_REMOTE_EXECUTION=true`. Keep `WORKSPACE_DIRS` limited to intended project roots. Groups also require `TELEGRAM_ALLOWED_USER_IDS`. A user authorized to run an AI CLI can exercise that CLI's account privileges. Workspace checks are not an OS sandbox.

Installing or restarting a background service is a separate explicit choice: `npm run service:install`, `service:restart`, `service:status`, `service:uninstall`. Do not run those merely because this file was read.
