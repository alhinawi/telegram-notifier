const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
	TelegramClient,
	parseEnv,
	loadEnv,
} = require("../scripts/telegram-api");
function transport(responses) {
	const calls = [];
	return {
		calls,
		request(options, callback) {
			const req = new EventEmitter();
			calls.push({ options });
			req.setTimeout = (ms, fn) => {
				req.timeout = fn;
				calls.at(-1).timeout = ms;
			};
			req.destroy = (error) => req.emit("error", error);
			req.end = (body) => {
				calls.at(-1).body = JSON.parse(body);
				process.nextTick(() => {
					const item = responses.shift();
					if (item === "timeout") return req.timeout();
					if (item instanceof Error) return req.emit("error", item);
					const res = new EventEmitter();
					res.statusCode = item.code || 200;
					callback(res);
					res.emit(
						"data",
						item.raw ?? JSON.stringify(item.body || { ok: true, result: {} }),
					);
					res.emit("end");
				});
			};
			return req;
		},
	};
}
test("dotenv supports export, quotes, comments, empty values and CRLF", () => {
	assert.deepEqual(
		parseEnv(
			"export A=\"hello world\"\r\nB=two # comment\nC=\n# no\nD='quoted'\nBAD-LINE=x",
		),
		{ A: "hello world", B: "two", C: "", D: "quoted" },
	);
});
test("environment empty strings are explicit and not overwritten", () => {
	const fs = require("node:fs");
	const os = require("node:os");
	const path = require("node:path");
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notifier-env-"));
	const file = path.join(dir, ".env");
	fs.writeFileSync(file, "NOTIFIER_TEST=from-file");
	process.env.NOTIFIER_TEST = "";
	try {
		assert.equal(loadEnv([file]).NOTIFIER_TEST, "");
	} finally {
		delete process.env.NOTIFIER_TEST;
		fs.rmSync(dir, { recursive: true });
	}
});
test("transport sends UTF-8 JSON and defaults to safe plain text", async () => {
	const mock = transport([{}]);
	const c = new TelegramClient("123:test", { transport: mock });
	await c.sendMessage("1", "مرحبا `a_b`");
	assert.equal(mock.calls[0].body.text, "مرحبا `a_b`");
	assert.equal(mock.calls[0].body.parse_mode, undefined);
	assert.equal(
		mock.calls[0].options.headers["Content-Length"],
		Buffer.byteLength(JSON.stringify(mock.calls[0].body)),
	);
	assert.equal(mock.calls[0].timeout, 45000);
});
test("rate-limited sends retry after the server delay", async () => {
	const mock = transport([
		{
			code: 429,
			body: { ok: false, error_code: 429, parameters: { retry_after: 2 } },
		},
		{},
	]);
	const waits = [];
	await new TelegramClient("123:test", {
		transport: mock,
		sleep: async (ms) => waits.push(ms),
	}).sendMessage(1, "x");
	assert.deepEqual(waits, [2000]);
	assert.equal(mock.calls.length, 2);
});
test("uncertain send failures are not retried or duplicated", async () => {
	const mock = transport([new Error("secret URL")]);
	await assert.rejects(
		new TelegramClient("123:secret", { transport: mock }).sendMessage(1, "x"),
		/network request failed/,
	);
	assert.equal(mock.calls.length, 1);
});
test("safe reads retry bounded transient server errors", async () => {
	const mock = transport([{ code: 503, body: { ok: false } }, {}]);
	await new TelegramClient("123:test", {
		transport: mock,
		sleep: async () => {},
	}).getMe();
	assert.equal(mock.calls.length, 2);
});
test("request timeout rejects and does not retry send", async () => {
	const mock = transport(["timeout"]);
	await assert.rejects(
		new TelegramClient("123:test", { transport: mock }).sendMessage(1, "x"),
		/timed out/,
	);
	assert.equal(mock.calls.length, 1);
});
test("malformed responses are bounded and do not echo bodies", async () => {
	const mock = transport([{ raw: "secret HTML token" }]);
	await assert.rejects(
		new TelegramClient("123:test", { transport: mock }).sendMessage(1, "x"),
		/^TelegramError: Invalid JSON from Telegram$/,
	);
});
test("API error descriptions redact the bot token", async () => {
	const mock = transport([
		{ code: 401, body: { ok: false, description: "bad 123:secret" } },
	]);
	await assert.rejects(
		new TelegramClient("123:secret", { transport: mock }).getMe(),
		/bad \[REDACTED\]/,
	);
});
test("missing token and invalid API method fail before transport", async () => {
	await assert.rejects(new TelegramClient("").getMe(), /missing/);
	await assert.rejects(
		new TelegramClient("123:test").request("../bad"),
		/Invalid Telegram method/,
	);
});
test("poll payload preserves offset, timeout and allowed updates", async () => {
	const mock = transport([{}]);
	await new TelegramClient("123:test", { transport: mock }).getUpdates(42, 30);
	assert.deepEqual(mock.calls[0].body, {
		offset: 42,
		timeout: 30,
		limit: 100,
		allowed_updates: ["message", "callback_query"],
	});
});
module.exports = { transport };
test("absolute deadline rejects even if socket idle timeout never fires", async () => {
	const hanging = {
		request() {
			const req = new EventEmitter();
			req.setTimeout = () => {};
			req.end = () => {};
			req.destroy = (err) => req.emit("error", err);
			return req;
		},
	};
	await assert.rejects(
		new TelegramClient("123:test", {
			transport: hanging,
			timeoutMs: 15,
		}).sendMessage(1, "x"),
		/deadline exceeded/,
	);
});
test("JSON null response fails cleanly rather than throwing in an event handler", async () => {
	const mock = transport([{ raw: "null" }]);
	await assert.rejects(
		new TelegramClient("123:test", { transport: mock }).sendMessage(1, "x"),
		/Invalid response schema/,
	);
});
test("long rate limit fails rather than retrying earlier than requested", async () => {
	const mock = transport([
		{
			code: 429,
			body: { ok: false, error_code: 429, parameters: { retry_after: 120 } },
		},
	]);
	await assert.rejects(
		new TelegramClient("123:test", {
			transport: mock,
			sleep: async () => assert.fail("must not retry early"),
		}).sendMessage(1, "x"),
	);
	assert.equal(mock.calls.length, 1);
});
