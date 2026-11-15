const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = fs.realpathSync(
	fs.mkdtempSync(path.join(os.tmpdir(), "notifier-sec-")),
);
process.env.TELEGRAM_NOTIFIER_STATE_DIR = path.join(root, "state");
const store = require("../scripts/state");
const {
	isAuthorized,
	resolveWorkspace,
	createController,
} = require("../scripts/listener");
const { runTask, agentCommand } = require("../scripts/runner");
const env = { TELEGRAM_CHAT_ID: "42", AI_AGENT_CLI: "gemini" };
const message = (text, extra = {}) => ({
	chat: { id: 42, type: "private" },
	from: { id: 42 },
	text,
	...extra,
});
function mockClient() {
	const sent = [];
	return {
		sent,
		async sendMessage(id, text) {
			sent.push(text);
			return { message_id: 1 };
		},
		async answerCallbackQuery(id, text) {
			sent.push(text);
		},
		async editMessageText(id, mid, text) {
			sent.push(text);
		},
		async setMyCommands() {},
		async sendMessageWithButtons(id, text, kb) {
			sent.push({ text, kb });
		},
	};
}
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
test("private authorization requires both chat and actual sender", () => {
	assert.equal(isAuthorized(message("hi"), env), true);
	for (const item of [
		message("hi", { from: { id: 99 } }),
		message("hi", { from: { id: 42, is_bot: true } }),
		{ chat: { id: 42 } },
		null,
	])
		assert.equal(isAuthorized(item, env), false);
});
test("group authorization is closed unless sender explicitly allowlisted", () => {
	const msg = message("hi", { chat: { id: -100, type: "supergroup" } });
	assert.equal(isAuthorized(msg, { TELEGRAM_CHAT_ID: "-100" }), false);
	assert.equal(
		isAuthorized(msg, {
			TELEGRAM_CHAT_ID: "-100",
			TELEGRAM_ALLOWED_USER_IDS: "42, 55",
		}),
		true,
	);
});
test("workspace confinement rejects traversal and symlink escapes", () => {
	const allowed = path.join(root, "allowed");
	const outside = path.join(root, "outside");
	fs.mkdirSync(allowed);
	fs.mkdirSync(outside);
	fs.symlinkSync(
		outside,
		path.join(allowed, "link"),
		process.platform === "win32" ? "junction" : "dir",
	);
	assert.equal(resolveWorkspace(".", allowed, [allowed]), allowed);
	assert.equal(resolveWorkspace("../outside", allowed, [allowed]), null);
	assert.equal(resolveWorkspace("link", allowed, [allowed]), null);
});
test("callback without message is ignored without crashing", async () => {
	await createController(env, mockClient(), {
		state: {},
		roots: [root],
	}).handleCallbackQuery({ id: "q", data: "lang:ar" });
});
test("remote execution is disabled by default", async () => {
	let ran = false;
	const client = mockClient();
	const control = createController(env, client, {
		state: { activeWorkspace: root },
		roots: [root],
		runTask() {
			ran = true;
		},
	});
	await control.handleMessage(message("do work"));
	assert.equal(ran, false);
	assert.match(client.sent[0], /disabled/);
});
test("unauthorized messages and stale prompts never execute", async () => {
	let ran = false;
	const control = createController(
		{ ...env, ALLOW_REMOTE_EXECUTION: "true" },
		mockClient(),
		{
			state: { activeWorkspace: root },
			roots: [root],
			runTask() {
				ran = true;
			},
		},
	);
	await control.handleMessage(message("do work", { from: { id: 5 } }));
	await control.handleMessage(message("do work", { date: 1 }));
	assert.equal(ran, false);
});
test("unknown slash commands are never passed to the agent", async () => {
	let ran = false;
	const client = mockClient();
	await createController({ ...env, ALLOW_REMOTE_EXECUTION: "true" }, client, {
		state: {},
		roots: [root],
		runTask() {
			ran = true;
		},
	}).handleMessage(message("/typo"));
	assert.equal(ran, false);
	assert.match(client.sent[0], /Unknown/);
});
test("running task does not block /status or /stop, and rejects concurrent work", async () => {
	let finish;
	let cancelled = false;
	let runs = 0;
	const client = mockClient();
	const control = createController(
		{ ...env, ALLOW_REMOTE_EXECUTION: "true" },
		client,
		{
			state: { activeWorkspace: root },
			roots: [root],
			runTask() {
				runs++;
				return {
					done: new Promise((r) => {
						finish = r;
					}),
					cancel() {
						cancelled = true;
					},
				};
			},
		},
	);
	await control.handleMessage(message("first"));
	await control.handleMessage(message("second"));
	await control.handleMessage(message("/status"));
	await control.handleMessage(message("/stop"));
	assert.equal(runs, 1);
	assert.equal(cancelled, true);
	assert.ok(client.sent.some((s) => /Task: running/.test(s)));
	finish({ code: 0, stdout: "done" });
	await new Promise((r) => setImmediate(r));
});
test("project callback uses saved identity, never a freshly reordered index", async () => {
	const client = mockClient();
	const state = { activeWorkspace: root, projectChoices: { stable: root } };
	const control = createController(env, client, { state, roots: [root] });
	await control.handleCallbackQuery({
		id: "q",
		from: { id: 42 },
		message: message("projects"),
		data: "project:stable",
	});
	assert.equal(state.activeWorkspace, root);
	assert.deepEqual(state.projectChoices, {});
});
test("language callback rejects arbitrary file paths", async () => {
	const state = {};
	const client = mockClient();
	await createController(env, client, {
		state,
		roots: [root],
	}).handleCallbackQuery({
		id: "q",
		from: { id: 42 },
		message: message("lang"),
		data: "lang:../../package",
	});
	assert.equal(state.language, undefined);
	assert.match(client.sent[0], /Unsupported/);
});
test("approval decisions are message-bound, single-use, authorized, and expiring", () => {
	const id = store.createApproval(42);
	store.write("approval-" + id, {
		...store.read("approval-" + id),
		messageId: 9,
	});
	assert.equal(store.decideApproval(id, "approve", 99, 9), false);
	assert.equal(store.decideApproval(id, "approve", 42, 8), false);
	assert.equal(store.decideApproval(id, "unknown", 42, 9), false);
	assert.equal(store.decideApproval(id, "approve", 42, 9), true);
	assert.equal(store.decideApproval(id, "reject", 42, 9), false);
	const expired = store.createApproval(42, -1);
	assert.equal(store.decideApproval(expired, "approve", 42, 9), false);
	assert.equal(store.decideApproval("../state", "approve", 42, 9), false);
});
test("state files are private and corrupt state is not silently reset", () => {
	store.write("private", { hi: true });
	if (process.platform !== "win32")
		assert.equal(
			fs.statSync(path.join(store.stateDir(), "private.json")).mode & 0o777,
			0o600,
		);
	fs.writeFileSync(path.join(store.stateDir(), "bad.json"), "{invalid");
	assert.throws(() => store.read("bad"), /Cannot read/);
});
test("direct argument execution keeps command substitutions literal", async () => {
	const marker = path.join(root, "INJECTED");
	const prompt = `hello; touch ${marker}; $(touch ${marker})`;
	const script = path.join(root, "echo.js");
	fs.writeFileSync(script, "process.stdout.write(process.argv[2])");
	const result = await runTask({
		cli: process.execPath,
		args: [script],
		prompt,
		cwd: root,
	}).done;
	assert.equal(result.code, 0);
	assert.equal(result.stdout, prompt);
	assert.equal(fs.existsSync(marker), false);
});
test("missing executable produces exactly one clean result", async () => {
	const result = await runTask({
		cli: "/not/a/real/executable",
		prompt: "test",
		cwd: root,
	}).done;
	assert.equal(result.code, null);
	assert.match(result.error, /ENOENT/);
});
test("timeout terminates a real child process", async () => {
	const script = path.join(root, "wait.js");
	fs.writeFileSync(script, "setInterval(() => {}, 1000)");
	const result = await runTask({
		cli: process.execPath,
		args: [script],
		prompt: "test",
		cwd: root,
		timeoutSec: 1,
	}).done;
	assert.equal(result.timedOut, true);
	assert.notEqual(result.code, 0);
});
test("agent adapters use correct prompt arguments", () => {
	assert.deepEqual(agentCommand("claude", "x").args, ["-p", "x"]);
	assert.deepEqual(agentCommand("codex", "x").args, ["exec", "x"]);
	assert.deepEqual(agentCommand("aider", "x").args, ["--message", "x"]);
	assert.throws(() => agentCommand("bad\ncommand", "x"));
});
test("invalid timeouts and extra arguments fail before spawn", () => {
	for (const timeoutSec of [NaN, 0, -1, 86401])
		assert.throws(() =>
			runTask({ cli: "node", prompt: "x", cwd: root, timeoutSec }),
		);
	assert.throws(() =>
		runTask({ cli: "node", prompt: "x", cwd: root, args: "not-an-array" }),
	);
});
