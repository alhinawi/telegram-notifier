/** Dependency-free Telegram transport. Never logs URLs containing bot tokens. */
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
function parseEnv(content) {
	const result = {};
	for (const line of content.split(/\r?\n/)) {
		const match = line.match(
			/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/,
		);
		if (!match) continue;
		let value = match[2].trim();
		if (value.startsWith('"') && value.endsWith('"')) {
			try {
				value = JSON.parse(value);
			} catch {
				value = value.slice(1, -1);
			}
		} else if (value.startsWith("'") && value.endsWith("'"))
			value = value.slice(1, -1);
		else value = value.replace(/\s+#.*$/, "").trim();
		result[match[1]] = value;
	}
	return result;
}
function loadEnv(extraPaths = []) {
	const env = { ...process.env };
	const paths = [
		process.env.TELEGRAM_NOTIFIER_CONFIG,
		...extraPaths,
		path.resolve(process.cwd(), ".env"),
		path.resolve(__dirname, "..", ".env"),
		path.join(os.homedir(), ".gemini/config/plugins/telegram-notifier/.env"),
	].filter(Boolean);
	for (const file of paths) {
		try {
			for (const [key, value] of Object.entries(
				parseEnv(fs.readFileSync(file, "utf8")),
			))
				if (env[key] === undefined) env[key] = value;
		} catch (err) {
			if (err.code !== "ENOENT")
				throw new Error(`Cannot load config ${file}: ${err.message}`);
		}
	}
	return env;
}
class TelegramError extends Error {
	constructor(message, code, retryAfter) {
		super(message);
		this.name = "TelegramError";
		this.code = code;
		this.retryAfter = retryAfter;
	}
}
class TelegramClient {
	constructor(token, options = {}) {
		this.token = token;
		this.timeoutMs = options.timeoutMs ?? 45000;
		this.maxRetries = options.maxRetries ?? 2;
		this.transport = options.transport || https;
		this.sleep =
			options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
	}
	async request(method, payload = {}) {
		if (!this.token || /[\r\n/]/.test(this.token))
			throw new TelegramError("TELEGRAM_BOT_TOKEN is missing or invalid");
		if (!/^[a-zA-Z]+$/.test(method))
			throw new TelegramError("Invalid Telegram method");
		for (let attempt = 0; ; attempt++) {
			try {
				return await this.requestOnce(method, payload);
			} catch (err) {
				// Only a definitive 429 rejection is safe to retry for sends. Network/5xx
				// failures may have delivered a message: do not silently duplicate it.
				const safeRead = ["getMe", "getUpdates", "setMyCommands"].includes(
					method,
				);
				if (
					(err.retryAfter && err.retryAfter > 60) ||
					attempt >= this.maxRetries ||
					!(
						err.code === 429 ||
						(safeRead &&
							(err.code >= 500 ||
								err.code === "NETWORK" ||
								err.code === "TIMEOUT"))
					)
				)
					throw err;
				await this.sleep(
					Math.min(
						60000,
						err.retryAfter ? err.retryAfter * 1000 : 500 * 2 ** attempt,
					),
				);
			}
		}
	}
	requestOnce(method, payload) {
		return new Promise((resolve, reject) => {
			let deadline;
			const fail = (err) => {
				clearTimeout(deadline);
				reject(err);
			};
			const succeed = (value) => {
				clearTimeout(deadline);
				resolve(value);
			};
			const body = JSON.stringify(payload);
			const req = this.transport.request(
				{
					hostname: "api.telegram.org",
					port: 443,
					path: `/bot${this.token}/${method}`,
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Content-Length": Buffer.byteLength(body),
					},
				},
				(res) => {
					let data = "";
					res.setEncoding?.("utf8");
					res.on("error", () =>
						fail(new TelegramError("Telegram response interrupted", "NETWORK")),
					);
					res.on("aborted", () =>
						fail(new TelegramError("Telegram response aborted", "NETWORK")),
					);
					res.on("data", (chunk) => {
						data += chunk;
						if (Buffer.byteLength(data) > 8 * 1024 * 1024)
							req.destroy(
								new TelegramError(
									"Telegram response exceeds limit",
									"RESPONSE_LIMIT",
								),
							);
					});
					res.on("end", () => {
						let parsed;
						try {
							parsed = JSON.parse(data);
						} catch {
							return fail(
								new TelegramError("Invalid JSON from Telegram", res.statusCode),
							);
						}
						if (!parsed || typeof parsed !== "object")
							return fail(
								new TelegramError(
									"Invalid response schema from Telegram",
									res.statusCode,
								),
							);
						if (parsed.ok && res.statusCode >= 200 && res.statusCode < 300)
							return succeed(parsed.result);
						const description = String(
							parsed.description || `Telegram HTTP ${res.statusCode}`,
						)
							.split(this.token)
							.join("[REDACTED]");
						fail(
							new TelegramError(
								description,
								parsed.error_code || res.statusCode,
								parsed.parameters?.retry_after,
							),
						);
					});
				},
			);
			deadline = setTimeout(
				() =>
					req.destroy(
						new TelegramError("Telegram request deadline exceeded", "TIMEOUT"),
					),
				this.timeoutMs,
			);
			req.setTimeout(this.timeoutMs, () =>
				req.destroy(new TelegramError("Telegram request timed out", "TIMEOUT")),
			);
			req.on("error", (err) =>
				fail(
					err instanceof TelegramError
						? err
						: new TelegramError("Telegram network request failed", "NETWORK"),
				),
			);
			req.end(body);
		});
	}
	getMe() {
		return this.request("getMe");
	}
	getUpdates(
		offset = null,
		timeout = 30,
		limit = 100,
		allowedUpdates = ["message", "callback_query"],
	) {
		return this.request("getUpdates", {
			...(offset === null ? {} : { offset }),
			timeout,
			limit,
			allowed_updates: allowedUpdates,
		});
	}
	sendMessage(chatId, text, options = {}) {
		return this.request("sendMessage", {
			chat_id: chatId,
			text,
			disable_web_page_preview: true,
			...options,
		});
	}
	sendMessageWithButtons(chatId, text, inlineKeyboard = [], options = {}) {
		return this.sendMessage(chatId, text, {
			...options,
			reply_markup: { inline_keyboard: inlineKeyboard },
		});
	}
	editMessageText(chatId, messageId, text, options = {}) {
		return this.request("editMessageText", {
			chat_id: chatId,
			message_id: messageId,
			text,
			...options,
		});
	}
	answerCallbackQuery(id, text = "", showAlert = false) {
		return this.request("answerCallbackQuery", {
			callback_query_id: id,
			text,
			show_alert: showAlert,
		});
	}
	setMyCommands(commands = [], options = {}) {
		return this.request("setMyCommands", { commands, ...options });
	}
}
module.exports = { loadEnv, parseEnv, TelegramClient, TelegramError };
