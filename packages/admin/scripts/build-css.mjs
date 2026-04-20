#!/usr/bin/env node

/**
 * Build CSS Script
 *
 * Pre-compiles Tailwind CSS into a standalone CSS file with complete isolation.
 * This ensures the admin styles work independently of the consumer's Tailwind setup.
 *
 * Isolation Strategy:
 * 1. Compile CSS with Tailwind CLI
 * 2. Post-process to scope ALL utility classes within .adminapp
 * 3. This prevents any style conflicts with consumer app's Tailwind/CSS
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

  console.log("🔒 Scoping CSS utilities within .adminapp...");

  // Step 2: Post-process CSS to scope utilities within .adminapp
  let css = fs.readFileSync(tempFile, "utf-8");

  // Classes that are already scoped or should not be scoped
  const alreadyScopedPatterns = [
    /^\.adminapp/,
    /^\.dark\s*\.adminapp/,
    /^\.adminapp\.dark/,
    /^:root/,
    /^\*/,
    /^html/,
    /^body/,
    /^@keyframes/,
    /^@font-face/,
    /^@media/,
    /^@supports/,
    /^@layer/,
    /^@property/,
  ];

  /**
   * Scope a CSS selector within .adminapp
   * Handles complex selectors including pseudo-classes, combinators, etc.
   */
  function scopeSelector(selector) {
    selector = selector.trim();

    // Skip if already scoped or is a special selector
    for (const pattern of alreadyScopedPatterns) {
      if (pattern.test(selector)) {
        return selector;
      }
    }

    // Skip @-rules that aren't selectors
    if (selector.startsWith("@")) {
      return selector;
    }

    // Handle :root - convert to .adminapp
    if (selector === ":root") {
      return ".adminapp";
    }

    // Handle * selector
    if (selector === "*" || selector === "*::before" || selector === "*::after") {
      return `.adminapp ${selector}`;
    }

    // For regular selectors, prepend .adminapp
    // Handle comma-separated selectors
    if (selector.includes(",")) {
      return selector
        .split(",")
        .map((s) => scopeSelector(s.trim()))
        .join(", ");
    }

    // Prepend .adminapp to the selector
    return `.adminapp ${selector}`;
  }

  /**
   * Process CSS and scope all rules within .adminapp
   * This is a simple regex-based approach that handles most cases
   */
  function scopeCSS(css) {
    const lines = css.split("\n");
    const result = [];
    let inAtRule = 0;
    let inKeyframes = false;
    let braceCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Track @keyframes (don't scope contents)
      if (line.includes("@keyframes")) {
        inKeyframes = true;
        result.push(line);
        continue;
      }

      // Track braces for @keyframes
      if (inKeyframes) {
        braceCount += (line.match(/{/g) || []).length;
        braceCount -= (line.match(/}/g) || []).length;
        if (braceCount <= 0) {
          inKeyframes = false;
          braceCount = 0;
        }
        result.push(line);
        continue;
      }

      // Skip @-rules (media, supports, layer, etc.) - they get processed recursively
      if (
        line.trim().startsWith("@media") ||
        line.trim().startsWith("@supports") ||
        line.trim().startsWith("@layer") ||
        line.trim().startsWith("@font-face") ||
        line.trim().startsWith("@property")
      ) {
        result.push(line);
        continue;
      }

      // Check if line contains a selector (ends with {)
      if (line.includes("{") && !line.trim().startsWith("@")) {
        const parts = line.split("{");
        const selector = parts[0];
        const rest = parts.slice(1).join("{");

        // Skip if already has .adminapp
        if (selector.includes(".adminapp")) {
          result.push(line);
          continue;
        }

        // Skip CSS custom property declarations
        if (selector.trim().startsWith("--")) {
          result.push(line);
          continue;
        }

        // Scope the selector
        const scopedSelector = scopeSelector(selector);
        result.push(`${scopedSelector}{${rest}`);
      } else {
        result.push(line);
      }
    }

    return result.join("\n");
  }

  // Apply scoping
  css = scopeCSS(css);

  // Write scoped CSS to temp file
  const scopedTempFile = path.join(outputDir, "globals.scoped.css");
  fs.writeFileSync(scopedTempFile, css);

  // Clean up first temp file
  fs.unlinkSync(tempFile);

  // Step 3: Minify the final output
  console.log("📦 Minifying CSS...");
  execSync(`npx @tailwindcss/cli -i "${scopedTempFile}" -o "${outputFile}" --minify`, {
    cwd: rootDir,
    stdio: "inherit",
  });

  // Clean up scoped temp file
  fs.unlinkSync(scopedTempFile);

  // Get file size
  const stats = fs.statSync(outputFile);
  const sizeKB = (stats.size / 1024).toFixed(2);

  console.log(`✅ CSS compiled and scoped successfully (${sizeKB} KB)`);
  console.log(`   Output: ${outputFile}`);
  console.log(`   All utility classes are now scoped within .adminapp`);
} catch (error) {
  console.error("❌ Failed to build CSS:", error.message);
  process.exit(1);
}
