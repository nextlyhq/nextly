const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const file = "apps/playground/src/db/schemas/dynamic/index.ts";

try {
  // Check if we're in a git repository
  if (!fs.existsSync(".git")) {
    console.log("Not a git repository, skipping git configuration");
    process.exit(0);
  }

  // Check if file exists
  if (!fs.existsSync(file)) {
    console.log(`File ${file} not found, skipping`);
    process.exit(0);
  }

  // Configure git to ignore local changes
  execSync(`git update-index --skip-worktree ${file}`, { stdio: "ignore" });
  console.log(`✓ Configured git to ignore local changes to ${file}`);
} catch (error) {
  // Silently fail - this is not critical for package installation
  process.exit(0);
}
