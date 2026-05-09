#!/usr/bin/env node

/**
 * Scope CSS Script
 *
 * Post-processes the compiled Tailwind CSS to scope ALL rules under .adminapp
 * This ensures complete isolation from consumer app styles.
 *
 * Rules:
 * 1. All selectors get prefixed with .adminapp (e.g., .flex -> .adminapp .flex)
 * 2. :root variables get moved to .adminapp
 * 3. *, html, body selectors get scoped to .adminapp
 * 4. @keyframes and @font-face remain global (they're namespaced by their names)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const cssFile = path.join(rootDir, "dist/styles/globals.css");

console.log("🔒 Scoping CSS to .adminapp...");

try {
  let css = fs.readFileSync(cssFile, "utf-8");

  // Track if we're inside @keyframes or @font-face (don't scope these)
  let inAtRule = false;
  let atRuleDepth = 0;

  // Process the CSS line by line for simple transformations
  // For complex transformations, we use regex

  // 1. Scope :root to .adminapp
  css = css.replace(/:root\s*\{/g, ".adminapp {");

  // 2. Scope * selector to .adminapp *
  // But be careful not to match inside property values or comments
  css = css.replace(
    /(\{[^}]*)\*\s*,\s*:before\s*,\s*:after\s*,\s*::backdrop\s*\{/g,
    "$1.adminapp *,.adminapp *:before,.adminapp *:after,.adminapp *::backdrop{"
  );

  // 3. Replace the Tailwind preflight reset that targets *, :before, :after
  // AND remove the aggressive border-color: hsl(var(--border)) that overrides utilities
  css = css.replace(
    /(\*\s*,\s*:before\s*,\s*:after\s*,\s*::backdrop\s*\{[^}]*?)border-color:[^;}]*?;/g,
    "$1"
  );

  css = css.replace(
    /\*\s*,\s*:before\s*,\s*:after\s*,\s*::backdrop\s*\{/g,
    ".adminapp *,.adminapp *:before,.adminapp *:after,.adminapp *::backdrop{"
  );

  // 4. Scope html and body selectors
  css = css.replace(/\bhtml\s*\{/g, ".adminapp {");
  css = css.replace(/\bbody\s*\{/g, ".adminapp {");

  // 5. Add .adminapp prefix to utility classes in @layer utilities
  // This is complex because we need to handle the layer structure

  // For Tailwind v4, utilities are in @layer utilities
  // We need to scope selectors like .flex, .bg-blue-500, etc.

  // Simple approach: wrap utility classes
  // Match patterns like .class-name { or .class-name, or .class-name:pseudo
  const utilityPattern =
    /(@layer\s+utilities\s*\{)([\s\S]*?)(\}\s*(?=@layer|$))/g;

  css = css.replace(utilityPattern, (match, layerStart, content, layerEnd) => {
    // Scope all class selectors within utilities layer
    const scopedContent = content.replace(
      /(?<=^|[,\s{}])\.([a-zA-Z_-][\w-]*)/gm,
      ".adminapp .$1"
    );
    return layerStart + scopedContent + layerEnd;
  });

  // 6. For any remaining unscoped class selectors outside layers
  // Be conservative - only scope obvious utility-like classes
  // This regex finds class selectors at the start of a rule
  css = css.replace(
    /(?<=[,{}\s])\.(?!adminapp)([\w-]+)(?=\s*[,{:])/g,
    (match, className) => {
      // Skip if already inside .adminapp context
      // Skip animation names and other special classes
      const skipClasses = [
        "adminapp",
        "dark",
        "light",
        "animate-",
        "transition-",
      ];
      if (skipClasses.some((s) => className.startsWith(s))) {
        return match;
      }
      return `.adminapp .${className}`;
    }
  );

  fs.writeFileSync(cssFile, css, "utf-8");

  const stats = fs.statSync(cssFile);
  const sizeKB = (stats.size / 1024).toFixed(2);

  console.log(`✅ CSS scoped successfully (${sizeKB} KB)`);
} catch (error) {
  console.error("❌ Failed to scope CSS:", error.message);
  process.exit(1);
}
