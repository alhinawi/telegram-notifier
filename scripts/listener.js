#!/usr/bin/env node

/**
 * Telegram Interactive Listener Daemon (Two-Way Bridge)
 * Listens for commands and prompts from your phone via Telegram Bot,
 * executes them in your active workspace using your AI CLI agent,
 * and reports the results back with interactive buttons.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { loadEnv, TelegramClient } = require("./telegram-api");
const {
	discoverProjects,
	formatProjectsMessage,
	buildProjectsKeyboard,
	getGitBranch,
	getWorkspaceDirs,
	expandHome,
} = require("./projects");
const i18n = require("./i18n");

function getStateDir() {
	const homeDir = os.homedir();
	const homeStateDir = path.join(homeDir, ".telegram-notifier");
	try {
		if (!fs.existsSync(homeStateDir)) {
			fs.mkdirSync(homeStateDir, { recursive: true });
		}
		return homeStateDir;
	} catch {
		const localStateDir = path.resolve(__dirname, "..", ".telegram-notifier");
		if (!fs.existsSync(localStateDir)) {
			try {
				fs.mkdirSync(localStateDir, { recursive: true });
			} catch {
				// Ignore
			}
		}
		return localStateDir;
	}
}

function getStateFilePath() {
	return path.join(getStateDir(), "state.json");
}

function loadState() {
	const stateFile = getStateFilePath();
	try {
		if (fs.existsSync(stateFile)) {
			const data = JSON.parse(fs.readFileSync(stateFile, "utf8"));
			if (!Array.isArray(data.workspaceDirs)) {
				data.workspaceDirs = [];
			}
			return data;
		}
	} catch {
		// Ignore error and use default
	}
	return {
		activeWorkspace: process.cwd(),
		activeAgent: null,
		lastActivity: new Date().toISOString(),
		workspaceDirs: [],
		language: null,
	};
}

function updateEnvLanguage(newLang) {
	try {
		const envPaths = [
			path.resolve(__dirname, "..", ".env"),
			path.join(
				os.homedir(),
				".gemini",
				"config",
				"plugins",
				"telegram-notifier",
				".env",
			),
		];
		for (const envPath of envPaths) {
			if (fs.existsSync(envPath)) {
				let content = fs.readFileSync(envPath, "utf8");
				if (content.includes("NOTIFICATION_LANGUAGE=")) {
					content = content.replace(
						/NOTIFICATION_LANGUAGE=.*/g,
						`NOTIFICATION_LANGUAGE=${newLang}`,
					);
				} else {
					content += `\nNOTIFICATION_LANGUAGE=${newLang}\n`;
				}
				fs.writeFileSync(envPath, content, "utf8");
			}
		}
	} catch {
		// Ignore
	}
}

function saveState(state) {
	const stateFile = getStateFilePath();
	try {
		fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
	} catch (err) {
		console.error("Failed to save state:", err.message);
	}
}

// Global runtime variables
let runningProcess = null;
let runningTaskInfo = null;
let isStopping = false;

function getActiveWorkspace(state) {
	if (state.activeWorkspace && fs.existsSync(state.activeWorkspace)) {
		return state.activeWorkspace;
	}
	return process.cwd();
}

/**
 * Clean & truncate output text for Telegram message limits (max 4096 chars)
 */
function formatTelegramOutput(text, maxLength = 3500) {
	if (!text) return "_لا توجد مخرجات_";
	// Strip ANSI color codes
	const clean = text
		.replace(
			/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
			"",
		)
		.trim();
	if (clean.length <= maxLength) {
		return "```\n" + clean + "\n```";
	}
	const half = Math.floor(maxLength / 2) - 50;
	return (
		"```\n" +
		clean.slice(0, half) +
		"\n... [تم اختصار المخرجات الطويلة] ...\n" +
		clean.slice(clean.length - half) +
		"\n```"
	);
}

async function main() {
	const env = loadEnv();
	const botToken = env.TELEGRAM_BOT_TOKEN;
	const authorizedChatId = String(env.TELEGRAM_CHAT_ID || "").trim();
	const agentCli = env.AI_AGENT_CLI || "gemini";
	const taskTimeoutSec = parseInt(env.TASK_TIMEOUT || "600", 10);
	const lang = (
		env.LISTENER_LANGUAGE ||
		env.NOTIFICATION_LANGUAGE ||
		"ar"
	).toLowerCase();

	if (!botToken || !authorizedChatId) {
		console.error(
			"[Daemon Error] TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env",
		);
		process.exit(1);
	}

	const client = new TelegramClient(botToken);
	let state = loadState();

	console.log("========================================================");
	console.log("Telegram Notifier - Interactive Listener Daemon");
	console.log(`Authorized Chat ID: ${authorizedChatId}`);
	console.log(`AI Agent CLI: ${agentCli}`);
	console.log(`Active Workspace: ${getActiveWorkspace(state)}`);
	console.log(`Task Timeout: ${taskTimeoutSec}s`);
	console.log("========================================================\n");

	// Verify connection with Telegram
	try {
		const me = await client.getMe();
		console.log(`Connected as @${me.username} (${me.first_name})`);
	} catch (err) {
		console.error(`Failed to connect to Telegram API: ${err.message}`);
		process.exit(1);
	}

	// Register bot commands
	try {
		await client.setMyCommands([
			{ command: "projects", description: "عرض واختيار المشاريع الأخيرة" },
			{ command: "cd", description: "تغيير أو عرض مجلد المشروع النشط" },
			{ command: "dirs", description: "عرض وإدارة مجلدات المشاريع" },
			{ command: "language", description: "تغيير لغة البوت والإشعارات" },
			{ command: "status", description: "حالة الـ Daemon والمشروع النشط" },
			{ command: "stop", description: "إيقاف المهمة الجارية حالياً" },
			{ command: "help", description: "المساعدة وقائمة الأوامر" },
		]);
	} catch (e) {
		console.warn(`Could not register commands: ${e.message}`);
	}

	// Handle SIGINT / SIGTERM
	const cleanup = () => {
		isStopping = true;
		if (runningProcess) {
			try {
				runningProcess.kill("SIGTERM");
			} catch {
				// Ignore
			}
		}
		console.log("\nTelegram Listener Daemon shutting down.");
		process.exit(0);
	};
	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);

	// Send startup notification to user's phone
	try {
		const startMsg = i18n.t("daemon.startup", lang, {
			workspace: path.basename(getActiveWorkspace(state)),
			agent: agentCli,
		});

		await client.sendMessage(authorizedChatId, startMsg);
	} catch (err) {
		console.warn(`Could not send startup notification: ${err.message}`);
	}

	let offset = 0;

	// Main Long Polling Loop
	while (!isStopping) {
		try {
			const updates = await client.getUpdates(offset, 30);

			if (Array.isArray(updates) && updates.length > 0) {
				for (const update of updates) {
					offset = update.update_id + 1;

					const currentLang = (
						state.language ||
						env.LISTENER_LANGUAGE ||
						env.NOTIFICATION_LANGUAGE ||
						"ar"
					).toLowerCase();

					// Handle Callback Queries (Button Clicks)
					if (update.callback_query) {
						await handleCallbackQuery(
							client,
							update.callback_query,
							state,
							authorizedChatId,
							currentLang,
						);
					}

					// Handle Normal Messages
					if (update.message) {
						await handleMessage(
							client,
							update.message,
							state,
							authorizedChatId,
							agentCli,
							taskTimeoutSec,
							currentLang,
						);
					}
				}
			}
		} catch (err) {
			if (!isStopping) {
				console.error(`Polling error: ${err.message}`);
				await new Promise((r) => setTimeout(r, 4000));
			}
		}
	}
}

/**
 * Handle incoming text message / command
 */
async function handleMessage(
	client,
	message,
	state,
	authorizedChatId,
	agentCli,
	timeoutSec,
	lang,
) {
	const chatId = String(message.chat.id);

	// Security gate
	if (chatId !== authorizedChatId) {
		console.warn(
			`[Security Alert] Unauthorized access attempt from chat_id: ${chatId}`,
		);
		try {
			await client.sendMessage(chatId, i18n.t("daemon.unauthorized", lang));
		} catch {
			// Ignore
		}
		return;
	}

	const text = (message.text || "").trim();
	if (!text) return;

	const currentWorkspace = getActiveWorkspace(state);
	const projectName = path.basename(currentWorkspace);

	const [rawCmd, ...argParts] = text.split(/\s+/);
	const cmd = (rawCmd || "").toLowerCase().split("@")[0];
	const arg = argParts
		.join(" ")
		.trim()
		.replace(/^["']|["']$/g, "");

	// Command Routing
	if (cmd === "/start" || cmd === "/help") {
		const welcome = i18n.t("daemon.help", lang, {
			project: projectName,
			path: currentWorkspace,
			agent: agentCli,
		});

		await client.sendMessage(chatId, welcome);
		return;
	}

	if (cmd === "/projects" || cmd === "/recent") {
		const projects = discoverProjects(8);
		const msgText = formatProjectsMessage(projects, currentWorkspace, lang);
		const keyboard = buildProjectsKeyboard(projects, currentWorkspace);
		await client.sendMessageWithButtons(chatId, msgText, keyboard);
		return;
	}

	// Change or view active project workspace directory: /cd or /workspace or /project
	if (cmd === "/cd" || cmd === "/workspace" || cmd === "/project") {
		if (!arg) {
			const msg = i18n.t("daemon.cd_current_workspace", lang, {
				path: currentWorkspace,
			});
			await client.sendMessage(chatId, msg);
			return;
		}

		let targetPath = null;
		const directResolved = path.resolve(expandHome(arg));

		try {
			if (
				fs.existsSync(directResolved) &&
				fs.statSync(directResolved).isDirectory()
			) {
				targetPath = directResolved;
			}
		} catch {
			// Ignore
		}

		if (!targetPath) {
			const relResolved = path.resolve(currentWorkspace, expandHome(arg));
			try {
				if (
					fs.existsSync(relResolved) &&
					fs.statSync(relResolved).isDirectory()
				) {
					targetPath = relResolved;
				}
			} catch {
				// Ignore
			}
		}

		if (!targetPath) {
			const allProjects = discoverProjects(50);
			const match = allProjects.find(
				(p) =>
					p.name.toLowerCase() === arg.toLowerCase() ||
					path.basename(p.path).toLowerCase() === arg.toLowerCase(),
			);
			if (match) {
				targetPath = match.path;
			}
		}

		if (targetPath) {
			state.activeWorkspace = targetPath;
			state.lastActivity = new Date().toISOString();
			saveState(state);

			const targetName = path.basename(targetPath);
			const branch = getGitBranch(targetPath);
			const branchInfo = branch ? ` \`[${branch}]\`` : "";
			const confirmMsg = i18n.t("daemon.switched_workspace", lang, {
				name: targetName,
				branch: branchInfo,
				path: targetPath,
			});
			await client.sendMessage(chatId, confirmMsg);
		} else {
			const notFoundMsg = i18n.t("daemon.cd_not_found", lang, { path: arg });
			await client.sendMessage(chatId, notFoundMsg);
		}
		return;
	}

	// View scanned workspace directories: /dirs or /workspaces
	if (cmd === "/dirs" || cmd === "/workspaces") {
		const roots = getWorkspaceDirs();
		const formattedDirs =
			roots.length > 0
				? roots.map((d, i) => `${i + 1}. \`${d}\``).join("\n")
				: "_لا توجد مجلدات_";

		const msg = i18n.t("daemon.dirs_title", lang, {
			dirs: formattedDirs,
			active: currentWorkspace,
		});
		await client.sendMessage(chatId, msg);
		return;
	}

	// Add workspace root scan directory: /add_dir or /adddir or /set_dir
	if (cmd === "/add_dir" || cmd === "/adddir" || cmd === "/set_dir") {
		if (!arg) {
			await client.sendMessage(chatId, i18n.t("daemon.dirs_add_usage", lang));
			return;
		}

		const resolved = path.resolve(expandHome(arg));
		try {
			if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
				await client.sendMessage(
					chatId,
					i18n.t("daemon.dirs_not_found", lang, { path: arg }),
				);
				return;
			}
		} catch {
			await client.sendMessage(
				chatId,
				i18n.t("daemon.dirs_not_found", lang, { path: arg }),
			);
			return;
		}

		if (!Array.isArray(state.workspaceDirs)) {
			state.workspaceDirs = [];
		}

		if (
			state.workspaceDirs
				.map((d) => path.resolve(expandHome(d)))
				.includes(resolved)
		) {
			await client.sendMessage(
				chatId,
				i18n.t("daemon.dirs_already_exists", lang, { path: resolved }),
			);
			return;
		}

		state.workspaceDirs.push(resolved);
		saveState(state);

		await client.sendMessage(
			chatId,
			i18n.t("daemon.dirs_add_success", lang, { path: resolved }),
		);
		return;
	}

	// Remove workspace root scan directory: /del_dir or /rm_dir
	if (cmd === "/del_dir" || cmd === "/rm_dir") {
		if (!arg) {
			await client.sendMessage(chatId, i18n.t("daemon.dirs_add_usage", lang));
			return;
		}

		const resolved = path.resolve(expandHome(arg));
		if (Array.isArray(state.workspaceDirs)) {
			const idx = state.workspaceDirs.findIndex(
				(d) => path.resolve(expandHome(d)) === resolved,
			);
			if (idx !== -1) {
				state.workspaceDirs.splice(idx, 1);
				saveState(state);
				await client.sendMessage(
					chatId,
					i18n.t("daemon.dirs_del_success", lang, { path: resolved }),
				);
				return;
			}
		}
		await client.sendMessage(
			chatId,
			i18n.t("daemon.dirs_not_found", lang, { path: arg }),
		);
		return;
	}

	// Change or view language: /language or /lang
	if (cmd === "/language" || cmd === "/lang") {
		const available = i18n.getAvailableLanguages();
		const keyboard = available.map((l) => [
			{
				text: `${l.nativeName} (${l.name})${lang === l.code ? " (*)" : ""}`,
				callback_data: `lang:${l.code}`,
			},
		]);

		const msg = i18n.t("daemon.language_title", lang);
		await client.sendMessageWithButtons(chatId, msg, keyboard);
		return;
	}

	if (cmd === "/status") {
		const branch = getGitBranch(currentWorkspace);
		const statusMsg = [
			i18n.t("daemon.status_title", lang),
			i18n.t("daemon.status_active_project", lang, { project: projectName }),
			i18n.t("daemon.status_branch", lang, { branch: branch || "None" }),
			i18n.t("daemon.status_workspace", lang, { path: currentWorkspace }),
			i18n.t("daemon.status_agent", lang, { agent: agentCli }),
			runningProcess
				? i18n.t("daemon.status_task_running", lang)
				: i18n.t("daemon.status_task_idle", lang),
			runningTaskInfo
				? i18n.t("daemon.status_task_label", lang, {
						prompt: runningTaskInfo.prompt,
					})
				: "",
		]
			.filter(Boolean)
			.join("\n");

		await client.sendMessage(chatId, statusMsg);
		return;
	}

	if (cmd === "/stop") {
		if (runningProcess) {
			try {
				runningProcess.kill("SIGTERM");
			} catch {
				// Ignore
			}
			await client.sendMessage(chatId, i18n.t("daemon.stop_initiated", lang));
		} else {
			await client.sendMessage(chatId, i18n.t("daemon.stop_idle", lang));
		}
		return;
	}

	// Handle Regular Prompt Execution
	if (runningProcess) {
		await client.sendMessage(
			chatId,
			i18n.t("daemon.task_already_running", lang),
		);
		return;
	}

	await executePrompt(
		client,
		text,
		currentWorkspace,
		agentCli,
		timeoutSec,
		chatId,
		lang,
	);
}

/**
 * Handle button clicks (Callback Queries)
 */
async function handleCallbackQuery(
	client,
	callbackQuery,
	state,
	authorizedChatId,
	lang,
) {
	const chatId = String(callbackQuery.message.chat.id);
	const data = callbackQuery.data || "";
	const queryId = callbackQuery.id;

	if (chatId !== authorizedChatId) return;

	// 1. Project selection: proj:<index>
	if (data.startsWith("proj:")) {
		const index = parseInt(data.replace("proj:", ""), 10);
		const projects = discoverProjects(8);
		const selected = projects[index];

		if (selected) {
			state.activeWorkspace = selected.path;
			state.lastActivity = new Date().toISOString();
			saveState(state);

			await client.answerCallbackQuery(
				queryId,
				i18n.t("daemon.selected_project_alert", lang, { name: selected.name }),
			);

			const branch = selected.branch ? ` \`[${selected.branch}]\`` : "";
			const confirmMsg = i18n.t("daemon.switched_workspace", lang, {
				name: selected.name,
				branch: branch,
				path: selected.path,
			});

			await client.sendMessage(chatId, confirmMsg);
		} else {
			await client.answerCallbackQuery(
				queryId,
				i18n.t("daemon.project_not_found_alert", lang),
			);
		}
		return;
	}

	// 2. Interactive approvals: approve:<id> or reject:<id>
	if (data.startsWith("approval:")) {
		const parts = data.split(":");
		const action = parts[1]; // 'approve' or 'reject'
		const approvalId = parts[2];

		const isApprove = action === "approve";
		await client.answerCallbackQuery(
			queryId,
			isApprove
				? i18n.t("buttons.approve_alert", lang)
				: i18n.t("buttons.reject_alert", lang),
		);

		const actionText = isApprove
			? i18n.t("daemon.approval_confirmed", lang)
			: i18n.t("daemon.rejection_confirmed", lang);

		await client.sendMessage(chatId, actionText);
		return;
	}

	// 3. Language selection: lang:<lang_code>
	if (data.startsWith("lang:")) {
		const newLang = data.replace("lang:", "").trim();
		state.language = newLang;
		state.lastActivity = new Date().toISOString();
		saveState(state);
		updateEnvLanguage(newLang);

		await client.answerCallbackQuery(
			queryId,
			i18n.t("daemon.language_switched_alert", newLang),
		);

		// Update original message keyboard if message ID is available
		if (callbackQuery.message && callbackQuery.message.message_id) {
			const available = i18n.getAvailableLanguages();
			const keyboard = available.map((l) => [
				{
					text: `${l.nativeName} (${l.name})${newLang === l.code ? " (*)" : ""}`,
					callback_data: `lang:${l.code}`,
				},
			]);
			const updatedTitle = i18n.t("daemon.language_title", newLang);
			try {
				await client.editMessageText(
					chatId,
					callbackQuery.message.message_id,
					updatedTitle,
					{
						reply_markup: { inline_keyboard: keyboard },
					},
				);
			} catch {
				// Ignore if editing message fails
			}
		}

		const confirmMsg = i18n.t("daemon.language_switched", newLang);
		await client.sendMessage(chatId, confirmMsg);
		return;
	}

	await client.answerCallbackQuery(queryId);
}

/**
 * Execute prompt with configured AI CLI Agent
 */
async function executePrompt(
	client,
	promptText,
	workspacePath,
	agentCli,
	timeoutSec,
	chatId,
	lang,
) {
	const projectName = path.basename(workspacePath);

	// Send "Task Started" acknowledgement
	const promptPreview =
		promptText.slice(0, 150) + (promptText.length > 150 ? "..." : "");
	const startMsg = i18n.t("daemon.task_starting", lang, {
		project: projectName,
		prompt: promptPreview,
		agent: agentCli,
	});

	await client.sendMessage(chatId, startMsg);

	runningTaskInfo = {
		prompt: promptText,
		workspace: workspacePath,
		startTime: Date.now(),
	};

	let stdoutData = "";
	let stderrData = "";

	// Prepare command arguments based on CLI agent type
	let cmd = agentCli;
	let args = [];

	if (agentCli.includes(" ")) {
		// If user provided a command with arguments e.g. "gemini run" or "npx agent"
		const tokens = agentCli.split(" ");
		cmd = tokens[0];
		args = tokens.slice(1);
		args.push(promptText);
	} else if (["gemini", "claude", "agy"].includes(agentCli)) {
		// Gemini CLI, Claude Code, and Antigravity CLI (agy) format: <agent> -p "prompt"
		args = ["-p", promptText];
	} else if (agentCli === "aider") {
		args = ["--message", promptText];
	} else {
		args = [promptText];
	}

	// Ensure PATH contains user and package manager binary paths (~/.local/bin, /opt/homebrew/bin, etc.)
	const homeDir = os.homedir();
	const extraPaths = [
		path.join(homeDir, ".local", "bin"),
		"/opt/homebrew/bin",
		"/opt/homebrew/sbin",
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
		"/usr/sbin",
		"/sbin",
	];
	const enrichedPath = Array.from(
		new Set([...(process.env.PATH || "").split(":"), ...extraPaths]),
	)
		.filter(Boolean)
		.join(":");

	console.log(`[Executing] ${cmd} in ${workspacePath}`);

	try {
		runningProcess = spawn(cmd, args, {
			cwd: workspacePath,
			shell: true,
			env: {
				...process.env,
				PATH: enrichedPath,
				TELEGRAM_ACTIVE_WORKSPACE: workspacePath,
			},
		});

		let timeoutTimer = setTimeout(() => {
			if (runningProcess) {
				console.warn(`[Timeout] Task exceeded ${timeoutSec}s, terminating.`);
				runningProcess.kill("SIGTERM");
			}
		}, timeoutSec * 1000);

		runningProcess.stdout.on("data", (d) => {
			stdoutData += d.toString();
		});

		runningProcess.stderr.on("data", (d) => {
			stderrData += d.toString();
		});

		runningProcess.on("close", async (code) => {
			clearTimeout(timeoutTimer);
			const durationSec = Math.round(
				(Date.now() - runningTaskInfo.startTime) / 1000,
			);
			runningProcess = null;
			runningTaskInfo = null;

			console.log(
				`[Task Closed] Exit code: ${code}, Duration: ${durationSec}s`,
			);

			if (
				code === 127 ||
				(stderrData && stderrData.includes("command not found"))
			) {
				const notFoundHelp = i18n.t("daemon.command_not_found_help", lang, {
					cmd: cmd,
				});
				const resultMsg = `*${cmd}: command not found*\n\`${projectName}\`\n\n${notFoundHelp}`;
				await client.sendMessage(chatId, resultMsg);
				return;
			}

			if (code === 0) {
				const successTitle = i18n.t("daemon.task_finished_success", lang, {
					duration: durationSec,
				});
				const formattedOutput = formatTelegramOutput(stdoutData || stderrData);
				const resultMsg = `${successTitle}\n\`${projectName}\`\n\n${formattedOutput}`;
				await client.sendMessage(chatId, resultMsg);
			} else {
				const failTitle = i18n.t("daemon.task_finished_error", lang, {
					code: code,
					duration: durationSec,
				});
				const errorContent =
					stderrData ||
					stdoutData ||
					"Process terminated or command not found.";
				const formattedOutput = formatTelegramOutput(errorContent);
				const resultMsg = `${failTitle}\n\`${projectName}\`\n\n${formattedOutput}`;
				await client.sendMessage(chatId, resultMsg);
			}
		});

		runningProcess.on("error", async (err) => {
			clearTimeout(timeoutTimer);
			runningProcess = null;
			runningTaskInfo = null;

			console.error(`[Process Error]: ${err.message}`);
			const errTitle = i18n.t("daemon.spawn_failed_title", lang);
			const errHelp = i18n.t("daemon.spawn_failed_help", lang, {
				agent: agentCli,
			});
			const errMsg = `${errTitle}\n\n${err.message}\n${errHelp}`;
			await client.sendMessage(chatId, errMsg);
		});
	} catch (err) {
		runningProcess = null;
		runningTaskInfo = null;
		console.error(`[Execution Exception]: ${err.message}`);
		await client.sendMessage(chatId, `Exception: ${err.message}`);
	}
}

if (require.main === module) {
	main().catch((err) => {
		console.error("Fatal daemon error:", err);
		process.exit(1);
	});
}

module.exports = {
	main,
	formatTelegramOutput,
};
