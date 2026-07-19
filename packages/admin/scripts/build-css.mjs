#!/usr/bin/env node

/**
 * Build CSS Script
 *
 * Pre-compiles Tailwind CSS into a standalone CSS file with complete isolation.
 * This ensures the admin styles work independently of the consumer's Tailwind setup.
 *
 * Isolation Strategy:
 * 1. Compile CSS with Tailwind CLI
 * 2. Post-process to scope ALL utility classes within .nextly-admin
 * 3. This prevents any style conflicts with consumer app's Tailwind/CSS
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { findUnscopedRules, scopeCss } from "@nextlyhq/admin-css";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const inputFile = path.join(rootDir, "src/styles/globals.css");
const outputDir = path.join(rootDir, "dist/styles");
const outputFile = path.join(outputDir, "globals.css");
const tempFile = path.join(outputDir, "globals.temp.css");

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log("🎨 Building CSS with Tailwind...");

try {
  // Step 1: Run Tailwind CSS CLI to compile CSS (without minify first for processing)
  execSync(`npx @tailwindcss/cli -i "${inputFile}" -o "${tempFile}"`, {
    cwd: rootDir,
    stdio: "inherit",
  });

  console.log("🔒 Scoping CSS utilities within .nextly-admin...");

  // Step 2: Post-process CSS to scope utilities within .nextly-admin
  let css = fs.readFileSync(tempFile, "utf-8");

  // Apply scoping
  css = scopeCss(css);

  // Write scoped CSS to temp file
  const scopedTempFile = path.join(outputDir, "globals.scoped.css");
  fs.writeFileSync(scopedTempFile, css);

  // Clean up first temp file
  fs.unlinkSync(tempFile);

  // Step 3: Minify the final output
  console.log("📦 Minifying CSS...");
  execSync(
    `npx @tailwindcss/cli -i "${scopedTempFile}" -o "${outputFile}" --minify`,
    {
      cwd: rootDir,
      stdio: "inherit",
    }
  );

  // Clean up scoped temp file
  fs.unlinkSync(scopedTempFile);

  // Step 4: Guard the isolation invariant. The admin mounts inside the host
  // app's document, so any style rule that escapes .nextly-admin restyles the
  // host page. Fail the build rather than ship a leak.
  const unscoped = findUnscopedRules(fs.readFileSync(outputFile, "utf-8"));
  if (unscoped.length) {
    console.error(
      `\n❌ ${unscoped.length} style rule(s) escaped the .nextly-admin scope:\n`
    );
    for (const sel of unscoped) console.error("  " + sel);
    console.error(
      "\nEvery selector must be scoped. Selector lists are scoped per-selector,\n" +
        "so this usually means a new preflight/base selector shape reached\n" +
        "scopeSelector() unhandled.\n"
    );
    process.exit(1);
  }

  // Get file size
  const stats = fs.statSync(outputFile);
  const sizeKB = (stats.size / 1024).toFixed(2);

  console.log(`✅ CSS compiled and scoped successfully (${sizeKB} KB)`);
  console.log(`   Output: ${outputFile}`);
  console.log(`   All utility classes are now scoped within .nextly-admin`);
} catch (error) {
  console.error("❌ Failed to build CSS:", error.message);
  process.exit(1);
}
