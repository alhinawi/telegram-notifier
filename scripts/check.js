#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
for (const dir of ["scripts", "tests"].filter((d) =>
	fs.existsSync(path.join(__dirname, "..", d)),
))
	for (const name of fs.readdirSync(path.join(__dirname, "..", dir)))
		if (name.endsWith(".js"))
			execFileSync(
				process.execPath,
				["--check", path.join(__dirname, "..", dir, name)],
				{ stdio: "inherit" },
			);
console.log("All JavaScript syntax checks passed.");
