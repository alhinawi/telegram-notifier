const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { saveEnv } = require("../scripts/setup");
const { parseEnv } = require("../scripts/telegram-api");
const { diagnose } = require("../scripts/doctor");
const i18n = require("../scripts/i18n");
const { getGitBranch } = require("../scripts/projects");
const service = require("../scripts/service-manager");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "notifier-config-"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
test("setup saves quoted private config and round-trips JSON arrays", () => {
	const file = path.join(root, ".env");
	const config = {
		TELEGRAM_BOT_TOKEN: "123:test",
		AI_AGENT_ARGS: '["--model","test"]',
		WORKSPACE_DIRS: "/a path",
	};
	saveEnv(config, file);
	assert.deepEqual(parseEnv(fs.readFileSync(file, "utf8")), config);
	if (process.platform !== "win32")
		assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
test("setup refuses newline config injection", () =>
	assert.throws(
		() => saveEnv({ A: "x\nEVIL=true" }, path.join(root, "bad")),
		/newlines/,
	));
test("noninteractive setup returns promptly with no prompts or service", () => {
	const result = spawnSync(process.execPath, ["scripts/setup.js"], {
		cwd: path.resolve(__dirname, ".."),
		env: {
			...process.env,
			TELEGRAM_BOT_TOKEN: "123:test",
			TELEGRAM_CHAT_ID: "42",
		},
		timeout: 2000,
		encoding: "utf8",
	});
	assert.equal(result.status, 0);
	assert.match(result.stdout, /interactive terminal/);
});
test("imports have no network, stdout, setup or exit side effects", () => {
	const result = execFileSync(
		process.execPath,
		[
			"-e",
			"for (const name of ['setup','notify','listener','doctor','auto-detect-chat-id','approval']) require('./scripts/'+name)",
		],
		{ encoding: "utf8", timeout: 2000 },
	);
	assert.equal(result, "");
});
test("diagnostics validate without ever including secret values", () => {
	const checks = diagnose({
		TELEGRAM_BOT_TOKEN: "123:superSecret",
		TELEGRAM_CHAT_ID: "42",
	});
	assert.ok(checks.every((c) => c.ok));
	assert.ok(!JSON.stringify(checks).includes("superSecret"));
	assert.ok(diagnose({ TELEGRAM_CHAT_ID: "-1" }).some((c) => !c.ok));
	assert.ok(diagnose({ TASK_TIMEOUT: "bad" }).some((c) => !c.ok));
	assert.ok(diagnose({ AI_AGENT_ARGS: "{}" }).some((c) => !c.ok));
});
test("locales have matching leaf keys, English fallback and safe locale lookup", () => {
	function keys(obj, prefix = "") {
		return Object.entries(obj)
			.flatMap(([k, v]) =>
				v && typeof v === "object" ? keys(v, prefix + k + ".") : [prefix + k],
			)
			.sort();
	}
	const en = JSON.parse(
		fs.readFileSync(path.join(__dirname, "../locales/en.json")),
	);
	const ar = JSON.parse(
		fs.readFileSync(path.join(__dirname, "../locales/ar.json")),
	);
	assert.deepEqual(keys(en), keys(ar));
	assert.equal(i18n.t("buttons.approve", "xx"), en.buttons.approve);
	assert.equal(
		i18n.getLocale("../../package").events.info.title,
		en.events.info.title,
	);
	assert.equal(i18n.t("events.info.title", "ar-eg"), ar.events.info.title);
});
test("git worktree branch detection follows gitdir files", () => {
	const project = path.join(root, "project");
	const git = path.join(root, "git-meta");
	fs.mkdirSync(project);
	fs.mkdirSync(git);
	fs.writeFileSync(path.join(project, ".git"), "gitdir: ../git-meta\n");
	fs.writeFileSync(path.join(git, "HEAD"), "ref: refs/heads/feature\n");
	assert.equal(getGitBranch(project), "feature");
});
test("service templates quote executable paths and escape XML", () => {
	const linux = service.generateLinuxService();
	assert.match(linux, /ExecStart="[^\n]+" "[^\n]+"/);
	const mac = service.generateMacPlist();
	assert.match(mac, /<key>ProgramArguments<\/key>/);
	assert.ok(!mac.includes("undefined"));
});
test("package never runs setup on install and versions agree", () => {
	const pkg = require("../package.json");
	const plugin = require("../plugin.json");
	assert.equal(pkg.scripts.postinstall, undefined);
	assert.equal(pkg.version, plugin.version);
	assert.equal(pkg.engines.node, ">=20");
});
test("setup updates notifier keys without deleting unrelated project config", () => {
	const file = path.join(root, "shared.env");
	fs.writeFileSync(
		file,
		'DATABASE_URL="postgres://example/local"\nTELEGRAM_CHAT_ID="1"\n',
	);
	saveEnv({ TELEGRAM_CHAT_ID: "42" }, file);
	assert.deepEqual(parseEnv(fs.readFileSync(file, "utf8")), {
		DATABASE_URL: "postgres://example/local",
		TELEGRAM_CHAT_ID: "42",
	});
});
