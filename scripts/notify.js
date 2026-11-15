#!/usr/bin/env node
/** Notification CLI and importable API. No network side effects on import. */
const path = require("node:path");
const fs = require("node:fs");
const { loadEnv, TelegramClient } = require("./telegram-api");
const store = require("./state");
const i18n = require("./i18n");
const aliases = {
	finish: "task_finished",
	task_finish: "task_finished",
	task_complete: "task_finished",
	task_completed: "task_finished",
	success: "task_finished",
	done: "task_finished",
	approval: "approval_required",
	approval_needed: "approval_required",
	feedback: "approval_required",
	prompt: "approval_required",
	ask: "approval_required",
	failed: "error",
	exception: "error",
	failure: "error",
	bug: "error",
};
const flags = new Set([
	"buttons",
	"no-buttons",
	"dry-run",
	"json",
	"silent",
	"help",
]);
const values = new Set([
	"type",
	"title",
	"message",
	"text",
	"project",
	"lang",
	"message-file",
	"thread-id",
]);
function parseArgs(args) {
	const result = {};
	for (let i = 0; i < args.length; i++) {
		const match = args[i].match(/^--([a-z-]+)(?:=(.*))?$/s);
		if (!match || (!flags.has(match[1]) && !values.has(match[1])))
			throw new Error(`Unknown argument: ${args[i]}`);
		const [, key, value] = match;
		if (flags.has(key)) {
			if (value !== undefined) throw new Error(`--${key} is a flag`);
			result[key] = true;
		} else {
			result[key] = value ?? args[++i];
			if (result[key] === undefined || result[key].startsWith("--"))
				throw new Error(`--${key} requires a value`);
		}
	}
	return result;
}
function splitText(text, limit = 3500) {
	if (!Number.isInteger(limit) || limit < 2)
		throw new Error("Invalid chunk limit");
	const result = [];
	let part = "";
	for (const char of text) {
		if (part.length + char.length > limit) {
			result.push(part);
			part = "";
		}
		part += char;
	}
	if (part || !result.length) result.push(part);
	return result;
}
function buildNotification(params, env = {}, now = new Date()) {
	const type = aliases[params.type] || params.type || "info";
	if (
		!["task_finished", "approval_required", "error", "info", "alert"].includes(
			type,
		)
	)
		throw new Error("Unsupported notification type");
	const saved = store.read("state", {});
	const lang = (
		params.lang ||
		saved.language ||
		env.NOTIFICATION_LANGUAGE ||
		"en"
	).toLowerCase();
	if (!/^[a-z]{2}(?:-[a-z]{2})?$/.test(lang))
		throw new Error("Invalid language code");
	const event = i18n.getLocale(lang).events[type];
	const project = params.project || path.basename(process.cwd());
	const message = params.message || params.text || "";
	const text = `[${event.label}] ${project}\n${params.title || event.title}\n${message ? "\n" + message + "\n" : ""}\n${now.toISOString()}`;
	return {
		type,
		lang,
		chunks: splitText(text),
		buttons:
			!!params.buttons ||
			(type === "approval_required" && !params["no-buttons"]),
	};
}
async function main(args = process.argv.slice(2), deps = {}) {
	const params = parseArgs(args);
	if (params.help) {
		console.log(
			"Usage: agent-notify --type task_finished --message TEXT [--project NAME] [--lang en|ar] [--dry-run] [--json] [--silent] [--message-file PATH|-] [--thread-id ID] [--buttons|--no-buttons]",
		);
		return;
	}
	if (params["message-file"])
		params.message = fs.readFileSync(
			params["message-file"] === "-" ? 0 : params["message-file"],
			"utf8",
		);
	const env = deps.env || loadEnv();
	const plan = buildNotification(params, env);
	if (params["dry-run"]) {
		console.log(JSON.stringify({ ...plan, dryRun: true }, null, 2));
		return plan;
	}
	if (!env.TELEGRAM_BOT_TOKEN || !/^-?\d+$/.test(env.TELEGRAM_CHAT_ID || ""))
		throw new Error(
			"Set TELEGRAM_BOT_TOKEN and a numeric TELEGRAM_CHAT_ID; run npm run setup",
		);
	if (params["thread-id"] && !/^[1-9]\d*$/.test(params["thread-id"]))
		throw new Error("thread-id must be a positive integer");
	const client = deps.client || new TelegramClient(env.TELEGRAM_BOT_TOKEN);
	const options = {
		disable_notification: !!params.silent,
		...(params["thread-id"]
			? { message_thread_id: Number(params["thread-id"]) }
			: {}),
	};
	const ids = [];
	let approvalId;
	for (const [index, text] of plan.chunks.entries()) {
		let result;
		if (plan.buttons && index === plan.chunks.length - 1) {
			approvalId = store.createApproval(env.TELEGRAM_CHAT_ID);
			result = await client.sendMessageWithButtons(
				env.TELEGRAM_CHAT_ID,
				text,
				[
					[
						{
							text: i18n.t("buttons.approve", plan.lang),
							callback_data: `approval:approve:${approvalId}`,
						},
						{
							text: i18n.t("buttons.reject", plan.lang),
							callback_data: `approval:reject:${approvalId}`,
						},
					],
				],
				options,
			);
			store.write("approval-" + approvalId, {
				...store.read("approval-" + approvalId),
				messageId: result.message_id,
			});
		} else
			result = await client.sendMessage(env.TELEGRAM_CHAT_ID, text, options);
		ids.push(result.message_id);
	}
	const result = {
		ok: true,
		messageIds: ids,
		...(approvalId ? { approvalId } : {}),
	};
	console.log(
		params.json
			? JSON.stringify(result)
			: `Notification sent (${plan.type}; ${ids.length} message(s))${approvalId ? "; approval ID: " + approvalId : ""}`,
	);
	return result;
}
if (require.main === module)
	main().catch((err) => {
		console.error("[Telegram Notifier] " + err.message);
		process.exitCode = 1;
	});
module.exports = { parseArgs, splitText, buildNotification, main };
