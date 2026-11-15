#!/usr/bin/env node
/** Read-only discovery. Never silently changes the authorized recipient. */
const { loadEnv, TelegramClient } = require("./telegram-api");
async function main() {
	const env = loadEnv();
	if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Set TELEGRAM_BOT_TOKEN first");
	const updates = await new TelegramClient(env.TELEGRAM_BOT_TOKEN).getUpdates(
		null,
		0,
	);
	const chats = new Map();
	for (const u of updates)
		if (u.message?.chat?.type === "private")
			chats.set(String(u.message.chat.id), {
				id: String(u.message.chat.id),
				type: "private",
			});
	console.log(
		JSON.stringify(
			{
				chats: [...chats.values()],
				note: "Read-only candidates. Verify your own ID in Telegram before configuring it. For challenge-based verification use npm run setup. Stop an existing listener before discovery.",
			},
			null,
			2,
		),
	);
}
if (require.main === module)
	main().catch((err) => {
		console.error("Discovery: " + err.message);
		process.exitCode = 1;
	});
module.exports = { main };
