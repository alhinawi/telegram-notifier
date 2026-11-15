#!/usr/bin/env node
/** Read an approval. Exit 0 approved, 2 rejected, 3 pending/expired/missing. */
const store = require("./state");
function main(id = process.argv[2]) {
	if (!/^[a-f0-9]{24}$/.test(id || ""))
		throw new Error("Usage: node scripts/approval.js <approval-id>");
	const value = store.read("approval-" + id, null);
	const status = !value
		? "missing"
		: value.status === "pending" && value.expiresAt < Date.now()
			? "expired"
			: value.status;
	console.log(JSON.stringify({ id, status }));
	process.exitCode = status === "approved" ? 0 : status === "rejected" ? 2 : 3;
}
if (require.main === module) {
	try {
		main();
	} catch (err) {
		console.error(err.message);
		process.exitCode = 1;
	}
}
module.exports = { main };
