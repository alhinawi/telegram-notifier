#!/usr/bin/env node
/** Offline by default; --online verifies getMe only, never sends a message. */
const { loadEnv, TelegramClient } = require("./telegram-api");
const fs = require("node:fs");
const { getWorkspaceDirs } = require("./projects");
function diagnose(env) {
	const checks = [
		{
			name: "Node.js >=20",
			ok: Number(process.versions.node.split(".")[0]) >= 20,
		},
		{
			name: "Bot token configured (redacted)",
			ok: /^\d+:[A-Za-z0-9_-]+$/.test(env.TELEGRAM_BOT_TOKEN || ""),
		},
		{ name: "Numeric chat ID", ok: /^-?\d+$/.test(env.TELEGRAM_CHAT_ID || "") },
		{
			name: "Group chat has an explicit sender allowlist",
			ok:
				!String(env.TELEGRAM_CHAT_ID || "").startsWith("-") ||
				/^\d+(,\s*\d+)*$/.test(env.TELEGRAM_ALLOWED_USER_IDS || ""),
		},
		{
			name: "Task timeout is 1..86400 seconds",
			ok:
				Number.isInteger(Number(env.TASK_TIMEOUT || 600)) &&
				Number(env.TASK_TIMEOUT || 600) >= 1 &&
				Number(env.TASK_TIMEOUT || 600) <= 86400,
		},
		{
			name: "Remote execution opt-in is valid",
			ok: ["true", "false", undefined, ""].includes(env.ALLOW_REMOTE_EXECUTION),
		},
	];
	try {
		const args = JSON.parse(env.AI_AGENT_ARGS || "[]");
		checks.push({
			name: "AI_AGENT_ARGS is a string array",
			ok: Array.isArray(args) && args.every((a) => typeof a === "string"),
		});
	} catch {
		checks.push({ name: "AI_AGENT_ARGS is valid JSON", ok: false });
	}
	return checks;
}
async function main(args = process.argv.slice(2)) {
	if (args.some((a) => !["--online", "--json"].includes(a)))
		throw new Error("Usage: doctor.js [--online] [--json]");
	const env = loadEnv();
	const checks = diagnose(env);
	const roots = getWorkspaceDirs();
	checks.push({
		name: "Accessible workspace root",
		ok: roots.some((p) => {
			try {
				return fs.statSync(p).isDirectory();
			} catch {
				return false;
			}
		}),
	});
	if (args.includes("--online")) {
		try {
			await new TelegramClient(env.TELEGRAM_BOT_TOKEN).getMe();
			checks.push({ name: "Telegram bot identity verified", ok: true });
		} catch (err) {
			checks.push({ name: "Telegram connection: " + err.message, ok: false });
		}
	}
	const result = {
		ok: checks.every((c) => c.ok),
		remoteExecution: env.ALLOW_REMOTE_EXECUTION === "true",
		checks,
	};
	console.log(
		args.includes("--json")
			? JSON.stringify(result, null, 2)
			: checks.map((c) => `${c.ok ? "PASS" : "FAIL"} ${c.name}`).join("\n") +
					"\nRemote execution: " +
					(result.remoteExecution ? "enabled" : "disabled"),
	);
	if (!result.ok) process.exitCode = 1;
	return result;
}
if (require.main === module)
	main().catch((err) => {
		console.error("Doctor: " + err.message);
		process.exitCode = 1;
	});
module.exports = { diagnose, main };
