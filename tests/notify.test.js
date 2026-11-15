const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.TELEGRAM_NOTIFIER_STATE_DIR = fs.mkdtempSync(
	path.join(os.tmpdir(), "notify-state-"),
);
const {
	parseArgs,
	splitText,
	buildNotification,
	main,
} = require("../scripts/notify");
const store = require("../scripts/state");
test.after(() =>
	fs.rmSync(process.env.TELEGRAM_NOTIFIER_STATE_DIR, {
		recursive: true,
		force: true,
	}),
);
test("CLI accepts equals, spaced values and literal shell characters", () => {
	assert.deepEqual(
		parseArgs([
			"--title=a=b",
			"--message",
			"don't run $(touch /tmp/nope)",
			"--silent",
		]),
		{ title: "a=b", message: "don't run $(touch /tmp/nope)", silent: true },
	);
});
for (const args of [
	["--wat"],
	["--title"],
	["--message", "--dry-run"],
	["--buttons=false"],
	["stray"],
])
	test("CLI rejects invalid arguments " + JSON.stringify(args), () =>
		assert.throws(() => parseArgs(args)),
	);
test("Unicode splitting preserves surrogate pairs and all text", () => {
	const text = "مرحبا😀".repeat(2000);
	const parts = splitText(text);
	assert.equal(parts.join(""), text);
	assert.ok(
		parts.every((p) => p.length <= 3500 && !/[\uD800-\uDBFF]$/.test(p)),
	);
});
test("finish aliases, literal markdown and timestamps are safe", () => {
	const plan = buildNotification(
		{ type: "done", project: "a_b`[]", message: "*not markup*" },
		{},
		new Date("2026-01-01T00:00:00Z"),
	);
	assert.equal(plan.type, "task_finished");
	assert.match(plan.chunks[0], /a_b`\[\]/);
	assert.match(plan.chunks[0], /2026-01-01T00:00:00.000Z/);
});
test("alert is not incorrectly normalized to info", () =>
	assert.equal(buildNotification({ type: "alert" }).type, "alert"));
test("unsupported types and language traversal fail", () => {
	assert.throws(() => buildNotification({ type: "typo" }), /Unsupported/);
	assert.throws(
		() => buildNotification({ lang: "../../etc" }),
		/Invalid language/,
	);
});
test("saved language wins over config, explicit flag wins over saved", () => {
	store.write("state", { language: "ar" });
	assert.equal(
		buildNotification({}, { NOTIFICATION_LANGUAGE: "en" }).lang,
		"ar",
	);
	assert.equal(buildNotification({ lang: "en" }).lang, "en");
	store.write("state", {});
});
test("approval buttons can be suppressed explicitly", () =>
	assert.equal(
		buildNotification({ type: "approval", "no-buttons": true }).buttons,
		false,
	));
test("dry run works without credentials and never sends", async () => {
	let calls = 0;
	const result = await main(["--dry-run", "--message", "preview"], {
		env: {},
		client: {
			sendMessage() {
				calls++;
			},
		},
	});
	assert.ok(result.chunks[0].includes("preview"));
	assert.equal(calls, 0);
});
test("notification sends in chunks with silent and topic options", async () => {
	const calls = [];
	await main(
		["--message", "x".repeat(8000), "--silent", "--thread-id", "7", "--json"],
		{
			env: { TELEGRAM_BOT_TOKEN: "123:test", TELEGRAM_CHAT_ID: "42" },
			client: {
				async sendMessage(chat, text, options) {
					calls.push({ chat, text, options });
					return { message_id: calls.length };
				},
			},
		},
	);
	assert.equal(calls.length, 3);
	assert.ok(
		calls.every(
			(c) =>
				c.options.disable_notification && c.options.message_thread_id === 7,
		),
	);
});
test("approval sends bind durable request to the actual message ID", async () => {
	const result = await main(["--type", "approval", "--json"], {
		env: { TELEGRAM_BOT_TOKEN: "123:test", TELEGRAM_CHAT_ID: "42" },
		client: {
			async sendMessageWithButtons(chat, text, keyboard) {
				assert.ok(keyboard[0][0].callback_data.length <= 64);
				return { message_id: 99 };
			},
		},
	});
	const value = store.read("approval-" + result.approvalId);
	assert.equal(value.status, "pending");
	assert.equal(value.messageId, 99);
});
test("invalid topic ID fails without a send", async () => {
	await assert.rejects(
		main(["--thread-id", "NaN"], {
			env: { TELEGRAM_BOT_TOKEN: "123:test", TELEGRAM_CHAT_ID: "42" },
		}),
		/positive integer/,
	);
});
