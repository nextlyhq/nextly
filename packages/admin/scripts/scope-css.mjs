#!/usr/bin/env node

/**
 * Scope CSS Script
 *
 * Post-processes the compiled Tailwind CSS to scope ALL rules under .nextly-admin
 * This ensures complete isolation from consumer app styles.
 *
 * Rules:
 * 1. All selectors get prefixed with .nextly-admin (e.g., .flex -> .nextly-admin .flex)
 * 2. :root variables get moved to .nextly-admin
 * 3. *, html, body selectors get scoped to .nextly-admin
 * 4. @keyframes and @font-face remain global (they're namespaced by their names)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const cssFile = path.join(rootDir, "dist/styles/globals.css");

console.log("🔒 Scoping CSS to .nextly-admin...");

try {
  let css = fs.readFileSync(cssFile, "utf-8");

  // Track if we're inside @keyframes or @font-face (don't scope these)
  let inAtRule = false;
  let atRuleDepth = 0;

  // Process the CSS line by line for simple transformations
  // For complex transformations, we use regex

  // 1. Scope :root to .nextly-admin
  css = css.replace(/:root\s*\{/g, ".nextly-admin {");

  // 2. Scope * selector to .nextly-admin *
  // But be careful not to match inside property values or comments
  css = css.replace(
    /(\{[^}]*)\*\s*,\s*:before\s*,\s*:after\s*,\s*::backdrop\s*\{/g,
    "$1.nextly-admin *,.nextly-admin *:before,.nextly-admin *:after,.nextly-admin *::backdrop{"
  );

  // 3. Replace the Tailwind preflight reset that targets *, :before, :after
  // AND remove the aggressive border-color: hsl(var(--border)) that overrides utilities
  css = css.replace(
    /(\*\s*,\s*:before\s*,\s*:after\s*,\s*::backdrop\s*\{[^}]*?)border-color:[^;}]*?;/g,
    "$1"
  );

  css = css.replace(
    /\*\s*,\s*:before\s*,\s*:after\s*,\s*::backdrop\s*\{/g,
    ".nextly-admin *,.nextly-admin *:before,.nextly-admin *:after,.nextly-admin *::backdrop{"
  );

  // 4. Scope html and body selectors
  css = css.replace(/\bhtml\s*\{/g, ".nextly-admin {");
  css = css.replace(/\bbody\s*\{/g, ".nextly-admin {");

  // 5. Add .nextly-admin prefix to utility classes in @layer utilities
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
      ".nextly-admin .$1"
    );
    return layerStart + scopedContent + layerEnd;
  });

  // 6. For any remaining unscoped class selectors outside layers
  // Be conservative - only scope obvious utility-like classes
  // This regex finds class selectors at the start of a rule
  css = css.replace(
    /(?<=[,{}\s])\.(?!nextly-admin)([\w-]+)(?=\s*[,{:])/g,
    (match, className) => {
      // Skip if already inside .nextly-admin context
      // Skip animation names and other special classes
      const skipClasses = [
        "nextly-admin",
        "dark",
        "light",
        "animate-",
        "transition-",
      ];
      if (skipClasses.some((s) => className.startsWith(s))) {
        return match;
      }
      return `.nextly-admin .${className}`;
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
