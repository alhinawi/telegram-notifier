---
name: telegram-notifier
description: Sends instant Telegram notifications to the user when a task finishes, approval or feedback is required, or an error occurs. Works with any AI coding agent (Antigravity, Claude Code, Cursor, Windsurf, Gemini CLI, etc.).
---

# Universal Telegram Notifier Skill

This skill allows any AI Agent to send instant Telegram notifications to the user's mobile phone.

## When to Trigger

The AI Agent MUST invoke this notification tool in the following situations:

1. **Task Finished**: After completing a user prompt, long-running task, build, test suite, or refactoring.
2. **Approval Required**: Before waiting for user confirmation, plan review, or high-stakes decision.
3. **Error Occurred**: When a command fails, build breaks, or an unexpected exception is encountered.

## Message Tone & Guidelines

| Event Type | Title Flag | Default Title | Description |
|---|---|---|---|
| Task finished | `--type="task_finished"` | `"خلصت يا معلم"` | Brief summary of what was completed |
| Approval needed | `--type="approval_required"` | `"محتاج اذنك يا معلم"` | What needs user review/approval |
| Error occurred | `--type="error"` | `"فيه مشكلة يا معلم"` | Brief description of error/failure |

> Note: You can customize `--title` and `--message` flags as needed.

## Execution Syntax

Run the notification script via Node.js:

### 1. Task Finished
```bash
node scripts/notify.js --type="task_finished" --title="خلصت يا معلم" --message="<brief summary of completed task>" --project="<project-name>"
```

### 2. Approval Required
```bash
node scripts/notify.js --type="approval_required" --title="محتاج اذنك يا معلم" --message="<what requires approval>" --project="<project-name>"
```

### 3. Error Occurred
```bash
node scripts/notify.js --type="error" --title="فيه مشكلة يا معلم" --message="<error details>" --project="<project-name>"
```

## Configuration

Credentials are loaded automatically from `.env` in the plugin directory or system environment variables:
- `TELEGRAM_BOT_TOKEN`: Token from Telegram @BotFather.
- `TELEGRAM_CHAT_ID`: Telegram Chat ID.
