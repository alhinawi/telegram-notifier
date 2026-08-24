---
name: telegram-notifier
description: Sends instant Telegram notifications to the user when a task finishes, approval or feedback is required, or an error occurs. Works automatically with any AI coding agent (Antigravity, Claude Code, Cursor, Windsurf, Gemini CLI, etc.).
---

# Universal Telegram Notifier Skill

This skill allows any AI Agent to send instant Telegram notifications to the user's mobile phone.

## When to Trigger Automatically

The AI Agent MUST invoke this notification tool automatically in the following situations:

1. **Task Finished**: After completing a user prompt, long-running task, build, test suite, or refactoring.
2. **Approval Required**: Before waiting for user confirmation, plan review, or high-stakes decision.
3. **Error Occurred**: When a command fails, build breaks, or an unexpected exception is encountered.

## Notification Language & Tone

The notification defaults to English (`en`), and can be switched to Egyptian Arabic (`ar-eg`) or Standard Arabic (`ar`):

| Event Type | Flag | English (Default) | Egyptian Arabic (`ar-eg`) | Standard Arabic (`ar`) |
|---|---|---|---|---|
| Task finished | `--type="task_finished"` | `"Task Finished"` | `"خلصت يا معلم"` | `"اكتملت المهمة بنجاح"` |
| Approval needed | `--type="approval_required"` | `"Approval Required"` | `"محتاج اذنك يا معلم"` | `"مطلوب مراجعة وتأكيد"` |
| Error occurred | `--type="error"` | `"Error Occurred"` | `"فيه مشكلة يا معلم"` | `"حدث خطأ أثناء التنفيذ"` |

> Note: Custom `--title` and `--message` flags can always be passed.

## Execution Syntax

Run the notification script via Node.js at the end of your work:

### 1. Task Finished (Default English)
```bash
node scripts/notify.js --type="task_finished" --message="Completed task successfully." --project="<project-name>"
```

### 2. Task Finished (Egyptian Arabic)
```bash
node scripts/notify.js --type="task_finished" --lang="ar-eg" --message="خلصت التعديلات وكل التيستات تمام" --project="<project-name>"
```

### 3. Approval Required
```bash
node scripts/notify.js --type="approval_required" --message="Waiting for your review on the implementation plan." --project="<project-name>"
```

### 4. Error Occurred
```bash
node scripts/notify.js --type="error" --message="Build failed: exit code 1" --project="<project-name>"
```

## Configuration

Credentials and language preferences are loaded automatically from `.env` or system environment variables:
- `TELEGRAM_BOT_TOKEN`: Token from Telegram @BotFather.
- `TELEGRAM_CHAT_ID`: Telegram Chat ID.
- `NOTIFICATION_LANGUAGE`: `en` (default), `ar-eg`, or `ar`.
