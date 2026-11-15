/** Execute an explicitly enabled agent directly, never via a shell. */
const { spawn } = require("node:child_process");
function agentCommand(cli, prompt) {
	// Arguments belong in AI_AGENT_ARGS, not a shell command string.
	if (!cli || /[\r\n]/.test(cli))
		throw new Error("AI_AGENT_CLI must be an executable path");
	const name = require("node:path")
		.basename(cli)
		.replace(/\.exe$/i, "");
	const args =
		name === "codex"
			? ["exec", prompt]
			: name === "aider"
				? ["--message", prompt]
				: ["gemini", "claude", "agy"].includes(name)
					? ["-p", prompt]
					: [prompt];
	return { command: cli, args };
}
function runTask({
	cli,
	args: extra = [],
	prompt,
	cwd,
	timeoutSec = 600,
	spawnImpl = spawn,
}) {
	if (!Number.isFinite(timeoutSec) || timeoutSec < 1 || timeoutSec > 86400)
		throw new Error("TASK_TIMEOUT must be 1..86400 seconds");
	if (!Array.isArray(extra) || extra.some((a) => typeof a !== "string"))
		throw new Error("AI_AGENT_ARGS must be a JSON string array");
	const spec = agentCommand(cli, prompt);
	const childEnv = { ...process.env, TELEGRAM_ACTIVE_WORKSPACE: cwd };
	// Agent subprocesses do not need transport credentials.
	delete childEnv.TELEGRAM_BOT_TOKEN;
	const child = spawnImpl(spec.command, [...extra, ...spec.args], {
		cwd,
		shell: false,
		detached: process.platform !== "win32",
		windowsHide: true,
		env: childEnv,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "",
		stderr = "",
		timedOut = false,
		killTimer;
	function kill(signal) {
		try {
			if (process.platform !== "win32" && child.pid)
				process.kill(-child.pid, signal);
			else child.kill(signal);
		} catch {}
	}
	function cancel() {
		kill("SIGTERM");
		killTimer = setTimeout(() => kill("SIGKILL"), 3000);
		killTimer.unref();
	}
	const timer = setTimeout(() => {
		timedOut = true;
		cancel();
	}, timeoutSec * 1000);
	const done = new Promise((resolve) => {
		child.stdout.on("data", (d) => {
			stdout = (stdout + d).slice(-64000);
		});
		child.stderr.on("data", (d) => {
			stderr = (stderr + d).slice(-64000);
		});
		let settled = false;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			clearTimeout(killTimer);
			resolve({ stdout, stderr, timedOut, ...result });
		};
		child.on("error", (err) => finish({ code: null, error: err.message }));
		child.on("close", (code, signal) => finish({ code, signal }));
	});
	return { cancel, done, child };
}
module.exports = { agentCommand, runTask };
