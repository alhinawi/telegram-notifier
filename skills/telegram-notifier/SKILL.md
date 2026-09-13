---
name: telegram-notifier
description: Sends instant Telegram notifications to the user when a task finishes, approval or feedback is required, or an error occurs, and acts as a two-way interactive control bridge between Telegram and AI coding agents.
---

# Universal Telegram Notifier & Interactive Control Bridge Skill

This skill allows any AI Agent to send instant Telegram notifications to the user's mobile phone and provides a **two-way interactive bridge** to receive commands, execute prompts, switch workspaces, and handle approvals directly from Telegram.

## When to Trigger Automatically

The AI Agent MUST invoke this notification tool automatically in the following situations:

1. **Task Finished**: After completing a user prompt, long-running task, build, test suite, or refactoring.
2. **Approval Required**: Before waiting for user confirmation, plan review, or high-stakes decision (with interactive inline approve/reject buttons).
3. **Error Occurred**: When a command fails, build breaks, or an unexpected exception is encountered.

## Setup & Configuration

If credentials are not yet configured in `.env`, run the interactive setup wizard:

```bash
node scripts/setup.js
```

Or interactively follow the prompt to set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, workspace paths, and auto-start the background daemon service.

## Two-Way Interactive Bridge (Daemon)

The interactive listener daemon allows you to send prompts and manage projects from Telegram:

- **Start Daemon (Foreground)**: `npm run daemon`
- **Install as Background Service (Auto-starts on boot)**: `npm run service:install`
- **Check Service Status**: `npm run service:status`
- **Stop/Uninstall Service**: `npm run service:uninstall`

### Telegram Bot Commands

- `/projects` - Browse and switch between recent projects using interactive buttons.
- `/status` - View active project, git branch, AI agent CLI, and running task status.
- `/stop` - Abort currently running task on the machine.
- `/help` - View command help and instructions.
- **Any text message**: Executed as a prompt by the configured AI CLI Agent (`gemini`, `claude`, etc.) in the active project.

## Notification Language & Tone

The notification defaults to Arabic (`ar`) or English (`en`):

| Event Type | Flag | English | Arabic (`ar`) |
| --- | --- | --- | --- |
| Task finished | `--type="task_finished"` | `"Task Finished"` | `"اكتملت المهمة بنجاح"` |
| Approval needed | `--type="approval_required"` | `"Approval Required"` | `"مطلوب مراجعة وتأكيد"` |
| Error occurred | `--type="error"` | `"Error Occurred"` | `"حدث خطأ أثناء التنفيذ"` |

## Execution Syntax

Run the notification script via Node.js:

### 1. Task Finished (Default)

```bash
node scripts/notify.js --type="task_finished" --message="Completed task successfully." --project="<project-name>"
```

### 2. Approval Required (with Interactive Buttons)

```bash
node scripts/notify.js --type="approval_required" --message="Waiting for your review on the implementation plan." --project="<project-name>"
```

*(Automatically renders 🟢 [Approve] and 🔴 [Reject] inline buttons on Telegram).*

### 3. Error Occurred

```bash
node scripts/notify.js --type="error" --message="Build failed: exit code 1" --project="<project-name>"
```
