#!/usr/bin/env node

/**
 * Build CSS Script
 *
 * Emits the package's three CSS entry points:
 *   - dist/theme.css  — the raw design-system source (tokens, @theme inline,
 *     @custom-variant, base reset) for consumers that compile Tailwind
 *     themselves against the token contract.
 *   - dist/styles.css — Tailwind + theme + this package's component utilities,
 *     pre-compiled and minified, so a consumer can drop it in with no setup.
 *     NOT scoped: tokens land on `:root` / `.dark` and Tailwind's preflight
 *     applies document-wide, which is what a greenfield app wants.
 *   - dist/styles.scoped.css — the same sheet with every rule confined to
 *     `.nextly-ui`. Preflight resets `html`/`body`/`*`, so the unscoped sheet
 *     restyles a host application that only wanted a few components; this
 *     variant normalises inside the wrapper and leaves the rest of the page
 *     untouched. Components still get the preflight they are designed against,
 *     which dropping preflight altogether would not give them.
 */

import { execSync } from "child_process";

import {
  scopeCss,
  findUnscopedRules,
  prefixKeyframes,
} from "@nextlyhq/admin-css";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const themeSource = path.join(rootDir, "src/styles/theme.css");
const stylesInput = path.join(rootDir, "src/styles/index.css");
const outputDir = path.join(rootDir, "dist");
const themeOutput = path.join(outputDir, "theme.css");
const stylesOutput = path.join(outputDir, "styles.css");
const scopedOutput = path.join(outputDir, "styles.scoped.css");

/** Wrapper class a consumer puts on the subtree that should be styled. */
const UI_SCOPE = ".nextly-ui";
/** Namespace for animation names, which CSS resolves globally. */
const KEYFRAME_PREFIX = "nx-";

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

try {
  // Ship the raw theme source untouched for source consumers.
  console.log("🎨 Copying theme.css...");
  fs.copyFileSync(themeSource, themeOutput);

  // Compile + minify the pre-compiled bundle.
  console.log("📦 Compiling styles.css with Tailwind...");
  execSync(
    `npx @tailwindcss/cli -i "${stylesInput}" -o "${stylesOutput}" --minify`,
    { cwd: rootDir, stdio: "inherit" },
  );

  // Scope for embedded use. The scoper is line-based, so it has to run on
  // unminified CSS — minified output puts the whole sheet on one line — which
  // is why this compiles again rather than reusing the minified bundle.
  console.log("🔒 Scoping styles for embedded use...");
  const unminified = path.join(outputDir, "styles.unscoped.tmp.css");
  const scopedTemp = path.join(outputDir, "styles.scoped.tmp.css");
  execSync(`npx @tailwindcss/cli -i "${stylesInput}" -o "${unminified}"`, {
    cwd: rootDir,
    stdio: "inherit",
  });

  // dist/ is published, so an intermediate left behind by a failed build would
  // ship. Every exit path from here clears them, including the leak bail-out —
  // which throws rather than calling process.exit, because process.exit does
  // not unwind the stack and would skip the cleanup entirely.
  try {
    // Selector scoping alone does not isolate animations: `@keyframes` names
    // are global, and this sheet defines `spin`, `pulse` and `fade-in`, which a
    // host page may well define too.
    const scoped = prefixKeyframes(
      scopeCss(fs.readFileSync(unminified, "utf8"), UI_SCOPE),
      KEYFRAME_PREFIX
    );
    const leaks = findUnscopedRules(scoped, UI_SCOPE);
    if (leaks.length > 0) {
      throw new Error(
        `${leaks.length} rule(s) escaped ${UI_SCOPE}:\n  ` +
          leaks.slice(0, 5).join("\n  ")
      );
    }
    fs.writeFileSync(scopedTemp, scoped);
    execSync(
      `npx @tailwindcss/cli -i "${scopedTemp}" -o "${scopedOutput}" --minify`,
      { cwd: rootDir, stdio: "inherit" }
    );
  } finally {
    fs.rmSync(unminified, { force: true });
    fs.rmSync(scopedTemp, { force: true });
  }

  const sizeKB = (fs.statSync(stylesOutput).size / 1024).toFixed(2);
  console.log(`✅ CSS built (styles.css ${sizeKB} KB)`);
  console.log(`   Output: ${themeOutput}`);
  console.log(`   Output: ${stylesOutput}`);
  console.log(`   Output: ${scopedOutput}`);
} catch (error) {
  console.error("❌ Failed to build CSS:", error.message);
  process.exit(1);
}
