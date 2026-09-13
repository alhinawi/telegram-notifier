/**
 * Projects Discovery and Management for Telegram Notifier
 * Scans configured workspace directories for projects and formats lists/keyboards for Telegram.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { loadEnv } = require("./telegram-api");
const i18n = require("./i18n");

/**
 * Expand ~ to user's home directory
 */
function expandHome(p) {
	if (!p) return p;
	if (p === "~") return os.homedir();
	if (p.startsWith("~/")) {
		return path.join(os.homedir(), p.slice(2));
	}
	return p;
}

/**
 * Read custom workspace dirs stored in user state
 */
function getStoredWorkspaceDirs() {
	try {
		const homeDir = os.homedir();
		const stateFile = path.join(homeDir, ".telegram-notifier", "state.json");
		if (fs.existsSync(stateFile)) {
			const data = JSON.parse(fs.readFileSync(stateFile, "utf8"));
			if (Array.isArray(data.workspaceDirs)) {
				return data.workspaceDirs;
			}
		}
	} catch {
		// Ignore
	}
	return [];
}

/**
 * Get configured workspace directories to scan
 */
function getWorkspaceDirs() {
	const env = loadEnv();
	const rawDirs = env.WORKSPACE_DIRS || "";
	const parsed = rawDirs
		.split(",")
		.map((d) => d.trim())
		.filter(Boolean)
		.map(expandHome);

	const stored = getStoredWorkspaceDirs().map(expandHome);

	// Always ensure current working directory is included
	const list = [...parsed, ...stored, process.cwd()];

	const home = os.homedir();
	const defaults = [
		path.join(home, "workspace", "personal"),
		path.join(home, "workspace"),
		path.join(home, "Projects"),
		path.join(home, "Developer"),
	];

	for (const def of defaults) {
		if (!list.includes(def)) {
			list.push(def);
		}
	}

	return [
		...new Set(
			list.filter((d) => {
				try {
					return fs.existsSync(d);
				} catch {
					return false;
				}
			}),
		),
	];
}

/**
 * Extract current git branch from .git folder without spawning a process
 */
function getGitBranch(projectPath) {
	try {
		const headPath = path.join(projectPath, ".git", "HEAD");
		if (fs.existsSync(headPath)) {
			const content = fs.readFileSync(headPath, "utf8").trim();
			if (content.startsWith("ref: refs/heads/")) {
				return content.replace("ref: refs/heads/", "");
			}
			return content.slice(0, 7); // detached commit hash
		}
	} catch {
		// Ignore
	}
	return null;
}

/**
 * Get project last modified timestamp
 */
function getProjectMtime(projectPath) {
	let latestTime = 0;
	try {
		const stat = fs.statSync(projectPath);
		latestTime = stat.mtimeMs;

		// Check .git or package.json for more accurate recent edit timestamp
		const gitHead = path.join(projectPath, ".git", "FETCH_HEAD");
		const gitIndex = path.join(projectPath, ".git", "index");
		const pkgJson = path.join(projectPath, "package.json");

		for (const f of [gitIndex, gitHead, pkgJson]) {
			if (fs.existsSync(f)) {
				const s = fs.statSync(f);
				if (s.mtimeMs > latestTime) latestTime = s.mtimeMs;
			}
		}
	} catch {
		// Ignore
	}
	return latestTime;
}

/**
 * Determine if a directory is a software project
 */
function isProjectDir(dirPath) {
	try {
		if (!fs.statSync(dirPath).isDirectory()) return false;
		const indicators = [
			".git",
			"package.json",
			"go.mod",
			"Cargo.toml",
			"pyproject.toml",
			"requirements.txt",
			"pom.xml",
			".agents",
		];
		return indicators.some((item) => fs.existsSync(path.join(dirPath, item)));
	} catch {
		return false;
	}
}

/**
 * Format relative time (e.g. "منذ ساعتين" / "2 hours ago")
 */
function formatTimeAgo(timestamp, lang = "en") {
	if (!timestamp) return "";
	const now = Date.now();
	const diffMs = now - timestamp;
	const diffMinutes = Math.floor(diffMs / (60 * 1000));
	const diffHours = Math.floor(diffMinutes / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffMinutes < 5) {
		return i18n.t("time.just_now", lang);
	}
	if (diffMinutes < 60) {
		return i18n.t("time.minutes_ago", lang, { minutes: diffMinutes });
	}
	if (diffHours < 24) {
		return i18n.t("time.hours_ago", lang, { hours: diffHours });
	}
	if (diffDays === 1) {
		return i18n.t("time.yesterday", lang);
	}
	return i18n.t("time.days_ago", lang, { days: diffDays });
}

/**
 * Scan workspace roots and return unique sorted projects
 */
function discoverProjects(maxCount = 10) {
	const roots = getWorkspaceDirs();
	const projectsMap = new Map();

	for (const root of roots) {
		if (!fs.existsSync(root)) continue;

		// Check if root itself is a project
		if (isProjectDir(root)) {
			projectsMap.set(path.resolve(root), {
				name: path.basename(root),
				path: path.resolve(root),
				mtime: getProjectMtime(root),
				branch: getGitBranch(root),
			});
		}

		// Scan immediate subdirectories
		try {
			const entries = fs.readdirSync(root, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isDirectory() && !entry.name.startsWith(".")) {
					const subPath = path.join(root, entry.name);
					if (isProjectDir(subPath)) {
						projectsMap.set(path.resolve(subPath), {
							name: entry.name,
							path: path.resolve(subPath),
							mtime: getProjectMtime(subPath),
							branch: getGitBranch(subPath),
						});
					}
				}
			}
		} catch {
			// Permission or reading errors
		}
	}

	const sorted = Array.from(projectsMap.values()).sort(
		(a, b) => b.mtime - a.mtime,
	);
	return sorted.slice(0, maxCount);
}

/**
 * Format project list text for Telegram message
 */
function formatProjectsMessage(projects, activePath = "", lang = "en") {
	const title = i18n.t("projects.title", lang);
	const noneFound = i18n.t("projects.none_found", lang);

	if (projects.length === 0) {
		return `${title}\n\n_${noneFound}_`;
	}

	const lines = [title, ""];

	projects.forEach((proj, index) => {
		const num = `[${index + 1}]`;
		const isActive =
			activePath && path.resolve(proj.path) === path.resolve(activePath);
		const activeBadge = isActive ? i18n.t("projects.active_badge", lang) : "";
		const timeAgo = formatTimeAgo(proj.mtime, lang);
		const branchInfo = proj.branch ? ` \`[${proj.branch}]\`` : "";
		const timeInfo = timeAgo ? ` _(${timeAgo})_` : "";

		lines.push(`${num} *${proj.name}*${activeBadge}${branchInfo}${timeInfo}`);
	});

	lines.push(i18n.t("projects.footer", lang));
	return lines.join("\n");
}

/**
 * Build Telegram Inline Keyboard buttons for project selection
 */
function buildProjectsKeyboard(projects, activePath = "") {
	const keyboard = [];

	projects.forEach((proj, index) => {
		const num = `${index + 1}.`;
		const isActive =
			activePath && path.resolve(proj.path) === path.resolve(activePath);
		const label = `${num} ${proj.name}${isActive ? " (*)" : ""}`;

		keyboard.push([
			{
				text: label,
				callback_data: `proj:${index}`,
			},
		]);
	});

	return keyboard;
}

// Allow standalone execution: node scripts/projects.js
if (require.main === module) {
	const env = loadEnv();
	const lang = env.NOTIFICATION_LANGUAGE || "en";
	const projects = discoverProjects(10);
	console.log(formatProjectsMessage(projects, process.cwd(), lang));
	console.log("\nDiscovered paths:");
	projects.forEach((p) =>
		console.log(`- ${p.name}: ${p.path} (${p.branch || "no git"})`),
	);
}

module.exports = {
	expandHome,
	getWorkspaceDirs,
	discoverProjects,
	formatProjectsMessage,
	buildProjectsKeyboard,
	getGitBranch,
};
