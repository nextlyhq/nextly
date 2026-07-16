#!/usr/bin/env node

/**
 * Build CSS Script
 *
 * Emits the package's two CSS entry points:
 *   - dist/theme.css  — the raw design-system source (tokens, @theme inline,
 *     @custom-variant, base reset) for consumers that compile Tailwind
 *     themselves against the token contract.
 *   - dist/styles.css — Tailwind + theme + this package's component utilities,
 *     pre-compiled and minified, so a consumer can drop it in with no setup.
 *
 * Unlike the admin build, output is NOT scoped: tokens land on `:root` / `.dark`
 * so a bare `import "@nextlyhq/ui/styles.css"` styles the whole document.
 */

import { execSync } from "child_process";
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

  const sizeKB = (fs.statSync(stylesOutput).size / 1024).toFixed(2);
  console.log(`✅ CSS built (styles.css ${sizeKB} KB)`);
  console.log(`   Output: ${themeOutput}`);
  console.log(`   Output: ${stylesOutput}`);
} catch (error) {
  console.error("❌ Failed to build CSS:", error.message);
  process.exit(1);
}
