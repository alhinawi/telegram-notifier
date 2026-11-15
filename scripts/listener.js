#!/usr/bin/env node
/** Single-owner Telegram control plane. Remote execution is opt-in. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { loadEnv, TelegramClient } = require("./telegram-api");
const store = require("./state");
const projects = require("./projects");
const i18n = require("./i18n");
const { splitText } = require("./notify");
const { runTask } = require("./runner");
function isAuthorized(message, env) {
	if (
		!message?.chat ||
		String(message.chat.id) !== String(env.TELEGRAM_CHAT_ID)
	)
		return false;
	if (message.from?.is_bot) return false;
	if (message.chat.type !== "private" && !env.TELEGRAM_ALLOWED_USER_IDS)
		return false;
	const allowed = String(env.TELEGRAM_ALLOWED_USER_IDS || env.TELEGRAM_CHAT_ID)
		.split(",")
		.map((x) => x.trim());
	return !!message.from && allowed.includes(String(message.from.id));
}
function resolveWorkspace(input, current, roots) {
	const expanded = projects.expandHome(input);
	const candidate = path.isAbsolute(expanded)
		? expanded
		: path.resolve(current, expanded);
	let real;
	try {
		real = fs.realpathSync(candidate);
		if (!fs.statSync(real).isDirectory()) return null;
	} catch {
		return null;
	}
	return roots.some((root) => {
		try {
			const rel = path.relative(fs.realpathSync(root), real);
			return (
				rel === "" ||
				(!rel.startsWith(".." + path.sep) &&
					rel !== ".." &&
					!path.isAbsolute(rel))
			);
		} catch {
			return false;
		}
	})
		? real
		: null;
}
function formatTelegramOutput(text, maxLength = 3500) {
	const clean = String(text || "")
		.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
		.trim();
	return clean.length > maxLength
		? clean.slice(0, maxLength / 2 - 20) +
				"\n[output truncated]\n" +
				clean.slice(-maxLength / 2 + 20)
		: clean || "(no output)";
}
function createController(env, client, deps = {}) {
	const state = deps.state || store.read("state", {});
	const roots = deps.roots || projects.getWorkspaceDirs();
	let task = null;
	const lang = () =>
		state.language ||
		env.LISTENER_LANGUAGE ||
		env.NOTIFICATION_LANGUAGE ||
		"en";
	const tr = (key, params) => i18n.t(key, lang(), params);
	const workspace = () =>
		resolveWorkspace(
			state.activeWorkspace || process.cwd(),
			process.cwd(),
			roots,
		) || roots[0];
	const save = () => store.write("state", state);
	async function send(text) {
		for (const part of splitText(String(text)))
			await client.sendMessage(env.TELEGRAM_CHAT_ID, part);
	}
	async function commandMenu() {
		const commands = [
			"projects",
			"cd",
			"ls",
			"dirs",
			"language",
			"status",
			"stop",
			"help",
		];
		await client.setMyCommands(
			commands.map((command) => ({
				command,
				description: tr("commands." + command),
			})),
			{ scope: { type: "chat", chat_id: env.TELEGRAM_CHAT_ID } },
		);
	}
	async function handleMessage(message) {
		if (!isAuthorized(message, env)) return;
		const text = (message.text || "").trim();
		if (!text) return;
		// Never replay queued historical prompts when the listener comes online.
		if (
			message.date &&
			Date.now() / 1000 - message.date > Number(env.MAX_UPDATE_AGE || 120)
		)
			return;
		const [raw, ...rest] = text.split(/\s+/);
		const cmd = raw.toLowerCase().split("@")[0];
		const arg = rest.join(" ");
		const cwd = workspace();
		if (!cwd) throw new Error("No accessible workspace roots configured");
		if (cmd === "/help" || cmd === "/start")
			return send(
				tr("daemon.help", {
					project: path.basename(cwd),
					path: cwd,
					agent: env.AI_AGENT_CLI || "gemini",
				}) +
					"\n\nRemote execution: " +
					(env.ALLOW_REMOTE_EXECUTION === "true"
						? "enabled"
						: "disabled (set ALLOW_REMOTE_EXECUTION=true to opt in)"),
			);
		if (cmd === "/status")
			return send(
				`Telegram Notifier\nWorkspace: ${cwd}\nAgent: ${env.AI_AGENT_CLI || "gemini"}\nRemote execution: ${env.ALLOW_REMOTE_EXECUTION === "true" ? "enabled" : "disabled"}\nTask: ${task ? "running" : "idle"}\nLanguage: ${lang()}`,
			);
		if (cmd === "/stop") {
			if (task) task.cancel();
			return send(tr(task ? "daemon.stop_initiated" : "daemon.stop_idle"));
		}
		if (cmd === "/dirs") return send(roots.join("\n"));
		if (cmd === "/projects" || cmd === "/recent") {
			const list = projects
				.discoverProjects(8)
				.filter((p) => resolveWorkspace(p.path, cwd, roots));
			state.projectChoices = Object.fromEntries(
				list.map((p) => [crypto.randomBytes(6).toString("hex"), p.path]),
			);
			save();
			return client.sendMessageWithButtons(
				env.TELEGRAM_CHAT_ID,
				projects.formatProjectsMessage(list, cwd, lang()),
				Object.entries(state.projectChoices).map(([id, value]) => [
					{ text: path.basename(value), callback_data: "project:" + id },
				]),
			);
		}
		if (cmd === "/language" || cmd === "/lang")
			return client.sendMessageWithButtons(
				env.TELEGRAM_CHAT_ID,
				tr("daemon.language_title"),
				i18n
					.getAvailableLanguages()
					.map((l) => [
						{ text: l.nativeName, callback_data: "lang:" + l.code },
					]),
			);
		if (["/cd", "/workspace", "/project"].includes(cmd)) {
			if (!arg) return send(cwd);
			const named = projects
				.discoverProjects(100)
				.filter((p) => p.name === arg);
			const target =
				resolveWorkspace(arg.replace(/^["']|["']$/g, ""), cwd, roots) ||
				(named.length === 1 && resolveWorkspace(named[0].path, cwd, roots));
			if (!target)
				return send(
					"Directory unavailable or outside configured WORKSPACE_DIRS.",
				);
			state.activeWorkspace = target;
			save();
			return send(
				tr("daemon.switched_workspace", {
					name: path.basename(target),
					path: target,
					branch: "",
				}),
			);
		}
		if (cmd === "/ls" || cmd === "/list") {
			const dir = resolveWorkspace(arg || ".", cwd, roots);
			if (!dir)
				return send(
					"Directory unavailable or outside configured WORKSPACE_DIRS.",
				);
			const entries = fs
				.readdirSync(dir, { withFileTypes: true })
				.filter((e) => !e.name.startsWith("."))
				.sort((a, b) => a.name.localeCompare(b.name));
			return send(
				dir +
					"\n\n" +
					entries
						.slice(0, 80)
						.map((e) => e.name + (e.isDirectory() ? "/" : ""))
						.join("\n") +
					(entries.length > 80 ? "\n[showing first 80 entries]" : ""),
			);
		}
		if (cmd.startsWith("/")) return send("Unknown command. Send /help.");
		if (env.ALLOW_REMOTE_EXECUTION !== "true")
			return send(
				"Remote execution is disabled. Set ALLOW_REMOTE_EXECUTION=true locally and restart only if you want Telegram prompts to run your AI CLI.",
			);
		if (task) return send(tr("daemon.task_already_running"));
		if (text.length > 12000)
			return send("Prompt too long (maximum 12000 characters).");
		const runner = deps.runTask || runTask;
		task = runner({
			cli: env.AI_AGENT_CLI || "gemini",
			args: JSON.parse(env.AI_AGENT_ARGS || "[]"),
			prompt: text,
			cwd,
			timeoutSec: Number(env.TASK_TIMEOUT || 600),
		});
		const active = task;
		const started = Date.now();
		// Keep polling while the child runs so /stop and /status remain responsive.
		active.done
			.then(async (result) => {
				if (task === active) task = null;
				const status = result.timedOut
					? "Timed out"
					: result.code === 0
						? "Task finished"
						: "Task failed";
				await send(
					`${status} (${Math.round((Date.now() - started) / 1000)}s)\n${path.basename(cwd)}\n\n${formatTelegramOutput(result.error || (result.code === 0 ? result.stdout || result.stderr : result.stderr || result.stdout))}`,
				);
			})
			.catch((err) =>
				console.error("Could not report task result: " + err.message),
			);
		return send(
			tr("daemon.task_starting", {
				project: path.basename(cwd),
				prompt: text.slice(0, 150),
				agent: env.AI_AGENT_CLI || "gemini",
			}),
		);
	}
	async function handleCallbackQuery(query) {
		if (!isAuthorized({ ...query.message, from: query.from }, env)) return;
		const data = query.data || "";
		if (data.startsWith("approval:")) {
			const [, action, id] = data.split(":");
			const ok = store.decideApproval(
				id || "",
				action,
				env.TELEGRAM_CHAT_ID,
				query.message.message_id,
			);
			await client.answerCallbackQuery(
				query.id,
				ok
					? action === "approve"
						? "Approved"
						: "Rejected"
					: "Expired, invalid, or already answered",
				!ok,
			);
			if (ok)
				await client.editMessageText(
					env.TELEGRAM_CHAT_ID,
					query.message.message_id,
					query.message.text +
						"\n\nDecision: " +
						(action === "approve" ? "Approved" : "Rejected"),
					{ reply_markup: { inline_keyboard: [] } },
				);
			return;
		}
		if (data.startsWith("project:")) {
			const target = state.projectChoices?.[data.slice(8)];
			const real = target && resolveWorkspace(target, workspace(), roots);
			if (!real)
				return client.answerCallbackQuery(
					query.id,
					"Project selection expired",
				);
			state.activeWorkspace = real;
			state.projectChoices = {};
			save();
			await client.answerCallbackQuery(query.id, "Workspace selected");
			return send(real);
		}
		if (data.startsWith("lang:")) {
			const code = data.slice(5);
			if (!i18n.getAvailableLanguages().some((l) => l.code === code))
				return client.answerCallbackQuery(query.id, "Unsupported language");
			state.language = code;
			save();
			await client.answerCallbackQuery(
				query.id,
				tr("daemon.language_switched_alert"),
			);
			await commandMenu();
			return send(tr("daemon.language_switched"));
		}
		return client.answerCallbackQuery(query.id, "Unknown or expired button");
	}
	return {
		handleMessage,
		handleCallbackQuery,
		commandMenu,
		stop: () => task?.cancel(),
	};
}
async function main() {
	const env = loadEnv();
	if (!env.TELEGRAM_BOT_TOKEN || !/^-?\d+$/.test(env.TELEGRAM_CHAT_ID || ""))
		throw new Error(
			"Configure TELEGRAM_BOT_TOKEN and numeric TELEGRAM_CHAT_ID first",
		);
	if (
		!Number.isInteger(Number(env.TASK_TIMEOUT || 600)) ||
		Number(env.TASK_TIMEOUT || 600) < 1 ||
		Number(env.TASK_TIMEOUT || 600) > 86400
	)
		throw new Error("TASK_TIMEOUT must be 1..86400");
	const lockDir = store.stateDir();
	fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
	const lock = path.join(lockDir, "listener.lock");
	try {
		fs.writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
	} catch (err) {
		if (err.code !== "EEXIST") throw err;
		const pid = Number(fs.readFileSync(lock, "utf8"));
		let live = true;
		try {
			process.kill(pid, 0);
		} catch (e) {
			if (e.code === "ESRCH") live = false;
		}
		if (live || !Number.isInteger(pid) || pid < 1)
			throw new Error(
				"Another listener may be running; inspect listener.lock before restarting",
			);
		fs.unlinkSync(lock);
		fs.writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
	}
	const client = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
	let controller;
	let stopping = false;
	const stop = () => {
		stopping = true;
		controller?.stop();
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	try {
		controller = createController(env, client);
		await client.getMe();
		await controller.commandMenu();
		console.log(
			"Listener online. Remote execution: " +
				(env.ALLOW_REMOTE_EXECUTION === "true" ? "enabled" : "disabled"),
		);
		// Negative offset skips offline backlog on each fresh start; no stale commands execute.
		let offset = -1;
		const backlog = await client.getUpdates(offset, 0);
		if (backlog.length) offset = backlog[backlog.length - 1].update_id + 1;
		else offset = 0;
		while (!stopping) {
			try {
				for (const update of await client.getUpdates(offset, 30)) {
					offset = update.update_id + 1;
					try {
						if (update.callback_query)
							await controller.handleCallbackQuery(update.callback_query);
						else if (update.message)
							await controller.handleMessage(update.message);
					} catch (err) {
						console.error("Update failed: " + err.message);
					}
				}
			} catch (err) {
				if (err.code === 409)
					throw new Error(
						"Telegram polling conflict: stop the other listener or remove the webhook explicitly",
					);
				if (!stopping) {
					console.error("Polling failed: " + err.message);
					await new Promise((r) => setTimeout(r, 4000));
				}
			}
		}
	} finally {
		controller?.stop();
		fs.unlinkSync(lock);
		process.removeListener("SIGINT", stop);
		process.removeListener("SIGTERM", stop);
	}
}
if (require.main === module)
	main().catch((err) => {
		console.error("Listener: " + err.message);
		process.exitCode = 1;
	});
module.exports = {
	main,
	createController,
	isAuthorized,
	resolveWorkspace,
	formatTelegramOutput,
};
