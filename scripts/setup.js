#!/usr/bin/env node
/** Explicit setup only. Installing the package never starts this wizard. */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const readline = require("node:readline/promises");
const { Writable } = require("node:stream");
const { loadEnv, TelegramClient } = require("./telegram-api");
const serviceManager = require("./service-manager");
const i18n = require("./i18n");
function saveEnv(config, target) {
	const lines = Object.entries(config).map(([key, value]) => {
		if (/[\r\n]/.test(String(value)))
			throw new Error("Configuration values cannot contain newlines");
		return key + "=" + JSON.stringify(String(value));
	});
	fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
	const temp = target + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
	try {
		fs.writeFileSync(temp, lines.join("\n") + "\n", {
			flag: "wx",
			mode: 0o600,
		});
		fs.renameSync(temp, target);
	} finally {
		try {
			fs.unlinkSync(temp);
		} catch {}
	}
}
function copyDir(src, dest) {
	if (path.resolve(src) === path.resolve(dest)) return;
	fs.cpSync(src, dest, {
		recursive: true,
		filter: (p) => !p.includes("node_modules") && !p.endsWith(".env"),
	});
}
function installGlobalPlugin(config) {
	const root = path.resolve(__dirname, "..");
	const dest = path.join(
		os.homedir(),
		".gemini/config/plugins/telegram-notifier",
	);
	fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
	for (const item of [
		"scripts",
		"locales",
		"package.json",
		"plugin.json",
		"SKILL.md",
		"LICENSE",
		"README.md",
	])
		copyDir(path.join(root, item), path.join(dest, item));
	saveEnv(config, path.join(dest, ".env"));
	return dest;
}
async function detectChatId(client, challenge) {
	for (let attempt = 0; attempt < 15; attempt++) {
		const updates = await client.getUpdates(null, 0);
		const match = updates.find(
			(u) =>
				u.message?.chat?.type === "private" &&
				u.message.text === "/start " + challenge &&
				!u.message.from?.is_bot,
		);
		if (match) return String(match.message.chat.id);
		await new Promise((r) => setTimeout(r, 3000));
	}
	return null;
}
async function main() {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		console.log(
			"Setup requires an interactive terminal. Set environment variables for CI; run npm run doctor to check configuration.",
		);
		return;
	}
	let hidden = false;
	const output = new Writable({
		write(chunk, encoding, cb) {
			if (!hidden) process.stdout.write(chunk);
			cb();
		},
	});
	const rl = readline.createInterface({
		input: process.stdin,
		output,
		terminal: true,
	});
	const ask = async (question, secret = false) => {
		if (secret) {
			process.stdout.write(question);
			hidden = true;
		}
		try {
			return (await rl.question(secret ? "" : question)).trim();
		} finally {
			hidden = false;
			if (secret) process.stdout.write("\n");
		}
	};
	try {
		console.log(
			"\nTelegram Notifier | Setup\nNo background service or remote execution is enabled without your choice.\n",
		);
		const current = loadEnv();
		let token = current.TELEGRAM_BOT_TOKEN;
		if (
			!token ||
			token === "your_bot_token_here" ||
			(await ask("Reuse the configured bot token? [Y/n] ")).toLowerCase() ===
				"n"
		)
			token = await ask("BotFather token (hidden): ", true);
		if (!/^\d+:[A-Za-z0-9_-]+$/.test(token))
			throw new Error("Invalid bot token format");
		const client = new TelegramClient(token);
		const bot = await client.getMe();
		console.log("Connected bot: @" + bot.username);
		let chatId = await ask(
			"Your numeric private chat ID (blank for challenge-based detection): ",
		);
		if (!chatId) {
			const challenge = crypto.randomBytes(8).toString("hex");
			console.log(
				`Send this exact message to @${bot.username}: /start ${challenge}`,
			);
			chatId = await detectChatId(client, challenge);
		}
		if (!/^\d+$/.test(chatId || ""))
			throw new Error(
				"A numeric private chat ID is required. Run setup again.",
			);
		const lang = (await ask("Language [en/ar], default en: ")) || "en";
		if (!["en", "ar"].includes(lang)) throw new Error("Choose en or ar");
		const dirs =
			(await ask("Workspace roots (comma-separated), default ~/workspace: ")) ||
			"~/workspace";
		const cli =
			(await ask("AI executable or full path, default gemini: ")) || "gemini";
		const remote =
			(
				await ask(
					"Allow Telegram messages to execute your AI agent on this computer? [y/N] ",
				)
			).toLowerCase() === "y";
		const config = {
			TELEGRAM_BOT_TOKEN: token,
			TELEGRAM_CHAT_ID: chatId,
			NOTIFICATION_LANGUAGE: lang,
			WORKSPACE_DIRS: dirs,
			AI_AGENT_CLI: cli,
			TASK_TIMEOUT: "600",
			ALLOW_REMOTE_EXECUTION: String(remote),
		};
		const target =
			process.env.TELEGRAM_NOTIFIER_CONFIG ||
			path.resolve(__dirname, "..", ".env");
		if (
			fs.existsSync(target) &&
			(
				await ask("Replace notifier configuration at " + target + "? [y/N] ")
			).toLowerCase() !== "y"
		)
			throw new Error("Setup cancelled; existing configuration preserved");
		saveEnv({ ...currentConfigOnly(current), ...config }, target);
		console.log("Saved private config: " + target);
		if (
			(
				await ask("Also install a global Gemini plugin copy? [y/N] ")
			).toLowerCase() === "y"
		)
			console.log("Installed: " + installGlobalPlugin(config));
		if (
			(
				await ask("Send one test notification to your chat now? [y/N] ")
			).toLowerCase() === "y"
		) {
			await client.sendMessage(chatId, i18n.t("setup.test_message", lang));
			console.log("Test notification sent.");
		}
		if (
			(
				await ask("Install the background listener service? [y/N] ")
			).toLowerCase() === "y"
		) {
			if (!serviceManager.installService())
				console.log(
					"Service did not start. Run npm run daemon in the foreground to diagnose.",
				);
		}
		console.log(
			"Setup saved. Run npm run doctor; start the listener explicitly with npm run daemon.",
		);
	} finally {
		rl.close();
	}
}
function currentConfigOnly(env) {
	return Object.fromEntries(
		Object.entries(env).filter(
			([k]) =>
				/^(TELEGRAM_|NOTIFICATION_LANGUAGE$|LISTENER_LANGUAGE$|WORKSPACE_DIRS$|AI_AGENT_|TASK_TIMEOUT$|ALLOW_REMOTE_EXECUTION$|MAX_UPDATE_AGE$)/.test(
					k,
				) && k !== "TELEGRAM_NOTIFIER_CONFIG",
		),
	);
}
if (require.main === module)
	main().catch((err) => {
		console.error("Setup: " + err.message);
		process.exitCode = 1;
	});
module.exports = { main, saveEnv, installGlobalPlugin, detectChatId };
