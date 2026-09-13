/**
 * Service Manager for Telegram Notifier Daemon
 * Automatically detects the OS and installs/manages background daemon service:
 * - macOS: launchd agent (~/Library/LaunchAgents/com.telegram-notifier.daemon.plist)
 * - Linux: systemd user service (~/.config/systemd/user/telegram-notifier.service)
 * - Windows: Startup script / Task scheduler
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const SERVICE_NAME = "com.telegram-notifier.daemon";
const LINUX_SERVICE_NAME = "telegram-notifier.service";

function getPaths() {
	const homeDir = os.homedir();
	let configDir = path.join(homeDir, ".telegram-notifier");
	let logDir = path.join(configDir, "logs");
	const scriptPath = path.resolve(__dirname, "listener.js");
	const nodeBinary = process.execPath;

	// Check if homeDir is writable, otherwise fallback to project directory
	try {
		if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
	} catch {
		configDir = path.resolve(__dirname, "..", ".telegram-notifier");
		logDir = path.join(configDir, "logs");
	}

	return { homeDir, configDir, logDir, scriptPath, nodeBinary };
}

function ensureDirs() {
	const { configDir, logDir } = getPaths();
	try {
		if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
		if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
	} catch (err) {
		console.warn(`[Notice] Could not create dirs: ${err.message}`);
	}
}

/**
 * macOS: launchd service configuration
 */
function getMacPlistPath() {
	const { homeDir } = getPaths();
	return path.join(homeDir, "Library", "LaunchAgents", `${SERVICE_NAME}.plist`);
}

function generateMacPlist() {
	const { nodeBinary, scriptPath, logDir, homeDir } = getPaths();
	const outLog = path.join(logDir, "daemon.out.log");
	const errLog = path.join(logDir, "daemon.err.log");
	const projectRoot = path.resolve(__dirname, "..");

	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodeBinary}</string>
        <string>${scriptPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>${projectRoot}</string>
    <key>StandardOutPath</key>
    <string>${outLog}</string>
    <key>StandardErrorPath</key>
    <string>${errLog}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"}</string>
        <key>HOME</key>
        <string>${homeDir}</string>
    </dict>
</dict>
</plist>
`;
}

/**
 * Linux: systemd user service configuration
 */
function getLinuxServicePath() {
	const { homeDir } = getPaths();
	return path.join(homeDir, ".config", "systemd", "user", LINUX_SERVICE_NAME);
}

function generateLinuxService() {
	const { nodeBinary, scriptPath, homeDir } = getPaths();
	const projectRoot = path.resolve(__dirname, "..");

	return `[Unit]
Description=Telegram Notifier Interactive Daemon
After=network.target

[Service]
Type=simple
ExecStart=${nodeBinary} ${scriptPath}
WorkingDirectory=${projectRoot}
Restart=always
RestartSec=5
Environment=PATH=${process.env.PATH || "/usr/local/bin:/usr/bin:/bin"}
Environment=HOME=${homeDir}

[Install]
WantedBy=default.target
`;
}

/**
 * Windows: Startup VBS wrapper to run in background
 */
function getWindowsStartupPath() {
	const appData =
		process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
	return path.join(
		appData,
		"Microsoft",
		"Windows",
		"Start Menu",
		"Programs",
		"Startup",
		"telegram-notifier.vbs",
	);
}

function generateWindowsVbs() {
	const { nodeBinary, scriptPath, logDir } = getPaths();
	const outLog = path.join(logDir, "daemon.out.log");
	const errLog = path.join(logDir, "daemon.err.log");

	return `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c ""${nodeBinary}"" ""${scriptPath}"" >> ""${outLog}"" 2>> ""${errLog}""", 0, False
`;
}

/**
 * Install the daemon as an OS background service
 */
function installService() {
	ensureDirs();
	const platform = process.platform;
	console.log(
		`\nDetected Operating System: ${platform} (${os.type()} ${os.release()})`,
	);

	if (platform === "darwin") {
		const plistPath = getMacPlistPath();
		const plistDir = path.dirname(plistPath);
		if (!fs.existsSync(plistDir)) fs.mkdirSync(plistDir, { recursive: true });

		// Stop existing if running
		try {
			execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`);
		} catch {
			// Ignore
		}

		fs.writeFileSync(plistPath, generateMacPlist(), "utf8");
		console.log(`Saved launchd configuration: ${plistPath}`);

		try {
			execSync(`launchctl load -w "${plistPath}"`);
			console.log(
				`Started macOS background service (${SERVICE_NAME}) successfully!`,
			);
			console.log(`   It will now auto-start when you log in.`);
			return true;
		} catch (e) {
			console.warn(`Warning during launchctl load: ${e.message}`);
			return false;
		}
	} else if (platform === "linux") {
		const servicePath = getLinuxServicePath();
		const serviceDir = path.dirname(servicePath);
		if (!fs.existsSync(serviceDir))
			fs.mkdirSync(serviceDir, { recursive: true });

		fs.writeFileSync(servicePath, generateLinuxService(), "utf8");
		console.log(`Saved systemd user service configuration: ${servicePath}`);

		try {
			execSync("systemctl --user daemon-reload");
			execSync(`systemctl --user enable --now ${LINUX_SERVICE_NAME}`);
			console.log(
				`Started Linux user service (${LINUX_SERVICE_NAME}) successfully!`,
			);
			return true;
		} catch (e) {
			console.warn(`Could not auto-enable systemd service: ${e.message}`);
			console.log(
				`You can run: systemctl --user enable --now ${LINUX_SERVICE_NAME}`,
			);
			return false;
		}
	} else if (platform === "win32") {
		const vbsPath = getWindowsStartupPath();
		const vbsDir = path.dirname(vbsPath);
		if (!fs.existsSync(vbsDir)) fs.mkdirSync(vbsDir, { recursive: true });

		fs.writeFileSync(vbsPath, generateWindowsVbs(), "utf8");
		console.log(`Saved Windows Startup launcher: ${vbsPath}`);
		console.log(
			`Telegram Notifier Daemon will start automatically with Windows.`,
		);
		return true;
	} else {
		console.warn(
			`Service installation is not supported for platform: ${platform}`,
		);
		console.log(`Run manually with: npm run daemon`);
		return false;
	}
}

/**
 * Uninstall the background service
 */
function uninstallService() {
	const platform = process.platform;
	console.log(`\nUninstalling background service for: ${platform}`);

	if (platform === "darwin") {
		const plistPath = getMacPlistPath();
		if (fs.existsSync(plistPath)) {
			try {
				execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`);
			} catch {
				// Ignore
			}
			fs.unlinkSync(plistPath);
			console.log(`Removed ${plistPath}`);
		}
		console.log(`Background service stopped and removed.`);
		return true;
	} else if (platform === "linux") {
		const servicePath = getLinuxServicePath();
		try {
			execSync(
				`systemctl --user stop ${LINUX_SERVICE_NAME} 2>/dev/null || true`,
			);
			execSync(
				`systemctl --user disable ${LINUX_SERVICE_NAME} 2>/dev/null || true`,
			);
		} catch {
			// Ignore
		}
		if (fs.existsSync(servicePath)) {
			fs.unlinkSync(servicePath);
			console.log(`Removed ${servicePath}`);
		}
		try {
			execSync("systemctl --user daemon-reload");
		} catch {
			// Ignore
		}
		console.log(`Service stopped and uninstalled.`);
		return true;
	} else if (platform === "win32") {
		const vbsPath = getWindowsStartupPath();
		if (fs.existsSync(vbsPath)) {
			fs.unlinkSync(vbsPath);
			console.log(`Removed ${vbsPath}`);
		}
		console.log(`Windows Startup launcher removed.`);
		return true;
	}
	return false;
}

/**
 * Check service status
 */
function checkStatus() {
	const platform = process.platform;
	const { logDir } = getPaths();
	console.log(`\nChecking background service status (${platform}):`);

	if (platform === "darwin") {
		const plistPath = getMacPlistPath();
		const installed = fs.existsSync(plistPath);
		console.log(
			`- Config file: ${installed ? "Installed (" + plistPath + ")" : "Not installed"}`,
		);

		try {
			const list = execSync(`launchctl list | grep ${SERVICE_NAME} || true`)
				.toString()
				.trim();
			if (list) {
				console.log(`- Status: Running (launchd entry: ${list})`);
			} else {
				console.log(`- Status: Loaded / Not currently running`);
			}
		} catch {
			console.log(`- Status: Unknown / Not running`);
		}
	} else if (platform === "linux") {
		try {
			const status = execSync(
				`systemctl --user is-active ${LINUX_SERVICE_NAME} 2>/dev/null || echo inactive`,
			)
				.toString()
				.trim();
			console.log(
				`- Status: ${status === "active" ? "Running" : "Inactive (" + status + ")"}`,
			);
		} catch {
			console.log(`- Status: Inactive`);
		}
	}

	console.log(`- Logs directory: ${logDir}`);
	const outLog = path.join(logDir, "daemon.out.log");
	if (fs.existsSync(outLog)) {
		const size = fs.statSync(outLog).size;
		console.log(`  Output log: ${outLog} (${size} bytes)`);
	}
}

// Allow CLI execution
if (require.main === module) {
	const cmd = (process.argv[2] || "status").toLowerCase();
	if (cmd === "install") {
		installService();
	} else if (cmd === "uninstall" || cmd === "remove") {
		uninstallService();
	} else if (cmd === "status") {
		checkStatus();
	} else if (cmd === "restart") {
		uninstallService();
		installService();
	} else {
		console.log(
			"Usage: node scripts/service-manager.js [install|uninstall|status|restart]",
		);
	}
}

module.exports = {
	installService,
	uninstallService,
	checkStatus,
	getPaths,
};
