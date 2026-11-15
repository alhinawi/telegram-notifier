/** Private, atomic local state. No credentials belong in this store. */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
function stateDir() {
	return (
		process.env.TELEGRAM_NOTIFIER_STATE_DIR ||
		path.join(os.homedir(), ".telegram-notifier")
	);
}
function read(name, fallback = {}) {
	try {
		return JSON.parse(
			fs.readFileSync(path.join(stateDir(), name + ".json"), "utf8"),
		);
	} catch (err) {
		if (err.code === "ENOENT") return fallback;
		throw new Error(`Cannot read ${name} state: ${err.message}`);
	}
}
function write(name, value) {
	const dir = stateDir();
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	const target = path.join(dir, name + ".json");
	const temp = target + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
	try {
		fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", {
			mode: 0o600,
			flag: "wx",
		});
		fs.renameSync(temp, target);
	} finally {
		try {
			fs.unlinkSync(temp);
		} catch {}
	}
}
function createApproval(chatId, ttl = 3600000) {
	const id = crypto.randomBytes(12).toString("hex");
	write("approval-" + id, {
		id,
		chatId: String(chatId),
		status: "pending",
		expiresAt: Date.now() + ttl,
	});
	return id;
}
function decideApproval(id, action, chatId, messageId) {
	if (!/^[a-f0-9]{24}$/.test(id) || !["approve", "reject"].includes(action))
		return false;
	const value = read("approval-" + id, null);
	if (
		!value ||
		value.chatId !== String(chatId) ||
		value.status !== "pending" ||
		value.expiresAt < Date.now() ||
		value.messageId !== messageId
	)
		return false;
	write("approval-" + id, {
		...value,
		status: action === "approve" ? "approved" : "rejected",
		decidedAt: new Date().toISOString(),
	});
	return true;
}
module.exports = { stateDir, read, write, createApproval, decideApproval };
