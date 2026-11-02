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

## Setup & Initialization

Upon adding this skill or before triggering it for the first time, check if `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are configured. If not configured, the AI Agent must execute the setup wizard immediately:

```bash
node scripts/setup.js
```

## Two-Way Interactive Bridge (Daemon)

The interactive listener daemon allows you to send prompts and manage projects from Telegram:

- **Start Daemon (Foreground)**: `npm run daemon`
- **Install as Background Service (Auto-starts on boot)**: `npm run service:install`
- **Check Service Status**: `npm run service:status`
- **Stop/Uninstall Service**: `npm run service:uninstall`

### Telegram Bot Commands

- `/projects` - Browse and switch between recent projects using interactive buttons.
- `/ls [path]` - List files and directories in the active workspace project.
- `/dirs` - View scanned workspace root folders.
- `/language` - Change bot and notification language with interactive buttons.
- `/status` - View active project, git branch, AI agent CLI, and running task status.
- `/stop` - Abort currently running task on the machine.
- `/help` - View command help and instructions.
- **Any text message**: Executed as a prompt by the configured AI CLI Agent (`gemini`, `claude`, etc.) in the active project.

## Notification Language & Tone

The notification defaults to Arabic (`ar`) or English (`en`):

| Event Type      | Flag                         | English               | Arabic (`ar`)             |
| --------------- | ---------------------------- | --------------------- | ------------------------- |
| Task finished   | `--type="task_finished"`     | `"Task Finished"`     | `"اكتملت المهمة بنجاح"`   |
| Approval needed | `--type="approval_required"` | `"Approval Required"` | `"مطلوب مراجعة وتأكيد"`   |
| Error occurred  | `--type="error"`             | `"Error Occurred"`    | `"حدث خطأ أثناء التنفيذ"` |


## Professional English & Git Commit Standards (Mandatory)

All task-completion notifications and all Git commit messages created by the agent MUST use professional, concise English.

### Non-negotiable tone rules
- Use English only for completion notifications, task summaries, approval requests, error reports, and commit messages.
- Use a neutral, professional, factual tone. Write as an engineering assistant reporting work, not as a friend chatting with the user.
- Never use colloquial Arabic, Egyptian slang, jokes, teasing, buddy-style language, nicknames, or overly familiar expressions.
- Never use phrases such as "خلصت يا معلم", "يا معلم", "تمام يا باشا", "done bro", "all done buddy", or similar informal wording.
- Do not copy conversational wording from the agent's chat response into the Git commit subject or Telegram notification.
- Do not claim completion, successful tests, or a successful push unless each action was actually completed and verified.

### Git commit message format
Use Conventional Commits:

`<type>(<optional-scope>): <concise imperative summary>`

Examples:
- `feat(auth): add persistent session recovery`
- `fix(gameverse): validate answer ownership server-side`
- `refactor(api): centralize request validation`
- `test(vocabulary): cover search edge cases`
- `docs(setup): clarify local agent configuration`

Commit message requirements:
- English only.
- Concise, specific, and factual; preferably 50–72 characters.
- Use an imperative verb (add, fix, update, remove, prevent, validate).
- Do not include greetings, first-person statements, emojis, jokes, or conversational sign-offs.
- Do not use the Telegram notification text as the commit message. The commit subject describes the code change; the notification reports the task outcome.

### Telegram completion notification
For every successful task completion, explicitly pass `--lang=en` and provide a concise factual summary.

Recommended command:

```bash
node scripts/notify.js --type="task_finished" --lang="en" --title="Task Completed" --message="Implemented <short summary>.\n\nFiles changed: <count or key files>\nChecks: <tests/build and actual result>\nGit: <commit hash and branch, or pull request URL>."
```

Use this message structure when relevant:
- **Summary:** What changed.
- **Validation:** Exact tests or build checks run and their outcomes.
- **Git:** Commit hash, branch, and PR URL when available.
- **Status:** State whether the work is complete, partially complete, or blocked.

If a check was not run, say "Not run" rather than implying it passed. If the push or PR creation failed, report that accurately. Keep the notification brief and do not include secrets, tokens, private user data, or raw environment values.

### Completion workflow
1. Finish implementation and run relevant checks.
2. Review the final diff.
3. Create a professional Conventional Commit message in English.
4. Commit and push only to the intended task branch, following repository instructions.
5. Verify the remote commit or PR exists.
6. Send the Telegram completion notification using `--lang=en`.
7. Ensure the notification and commit subject are independently written for their purposes and are never casual chat messages.

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

_(Automatically renders [Approve] and [Reject] inline buttons on Telegram)._

### 3. Error Occurred

```bash
node scripts/notify.js --type="error" --message="Build failed: exit code 1" --project="<project-name>"
```
