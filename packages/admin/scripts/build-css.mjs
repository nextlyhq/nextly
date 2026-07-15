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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

/**
 * Collect style-rule selectors that are not scoped under .nextly-admin.
 * Walks brace depth so nested at-rules (@layer/@media/@supports) are checked,
 * while at-rules whose bodies are not selectors (@keyframes steps, @property,
 * @font-face) are skipped.
 */
function findUnscopedRules(css) {
  const offenders = [];
  const skipAtRule = /^@(keyframes|font-face|property|counter-style|page)/i;
  // Comments would otherwise be swallowed into the following rule's prelude
  // (e.g. the leading `/*! tailwindcss ... */` banner before `@layer`).
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");

  function walk(block) {
    let i = 0;
    while (i < block.length) {
      const open = block.indexOf("{", i);
      if (open === -1) break;
      // Statement (e.g. @charset/@import) before any block — skip past it.
      const semi = block.indexOf(";", i);
      if (semi !== -1 && semi < open) {
        i = semi + 1;
        continue;
      }
      const prelude = block.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      for (; j < block.length && depth > 0; j++) {
        if (block[j] === "{") depth++;
        else if (block[j] === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      if (prelude.startsWith("@")) {
        if (!skipAtRule.test(prelude)) walk(block.slice(open + 1, j));
      } else if (prelude && !prelude.includes(".nextly-admin")) {
        offenders.push(prelude.slice(0, 100));
      }
      i = j + 1;
    }
  }

  walk(css);
  return [...new Set(offenders)];
}

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

  /**
   * Split a selector list on top-level commas only, so commas inside
   * functional pseudo-classes (e.g. `:where(.dark, .dark *)`) stay intact.
   */
  function splitTopLevel(selector) {
    const parts = [];
    let depth = 0;
    let cur = "";
    for (const ch of selector) {
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      if (ch === "," && depth === 0) {
        parts.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) parts.push(cur);
    return parts;
  }

  /**
   * Scope a CSS selector within .nextly-admin
   * Handles complex selectors including pseudo-classes, combinators, etc.
   */
  function scopeSelector(selector) {
    selector = selector.trim();
    if (!selector) return selector;

    // @-rules are not selectors.
    if (selector.startsWith("@")) return selector;

    // Nested selector: Tailwind v4 emits variants as `&:where(.dark, .dark *)`
    // inside an already-scoped parent rule. Scoping it again would corrupt the
    // variant, so leave nested selectors untouched.
    if (selector.startsWith("&")) return selector;

    // Selector lists: split on top-level commas so grouped preflight selectors
    // (`*, ::after, ::before, ::backdrop`, `html, :host`, `:root, :host`) each
    // get scoped, while `:where(...)` internals are preserved. Branch on the
    // split result, not on the presence of a comma — a selector whose only
    // commas sit inside parens yields one part and must not re-recurse.
    const parts = splitTopLevel(selector);
    if (parts.length > 1) {
      return parts.map((s) => scopeSelector(s.trim())).join(", ");
    }

    // Already scoped.
    if (selector.includes(".nextly-admin")) return selector;

    // Document-root selectors collapse onto the admin root so the theme and
    // the preflight reset apply inside the admin and never leak to the host.
    if (
      selector === ":root" ||
      selector === "html" ||
      selector === ":host" ||
      selector === "body"
    ) {
      return ".nextly-admin";
    }

    // The dark class sits on the admin root itself, not a descendant.
    if (selector === ".dark") return ".nextly-admin.dark";

    // Prepend .nextly-admin to the selector (covers `*`, elements, pseudos).
    return `.nextly-admin ${selector}`;
  }

  /**
   * Process CSS and scope all rules within .nextly-admin
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

        // Contain the imported design-system token blocks to the admin scope so
        // tokens never leak to the host document. Only the bare `:root` / `.dark`
        // blocks (the theme) are mapped; Tailwind's own compound `:root, :host`
        // theme block and the `.dark:where(...)` utilities are left untouched.
        const bareSelector = selector.trim();
        if (bareSelector === ":root") {
          result.push(`.nextly-admin{${rest}`);
          continue;
        }
        if (bareSelector === ".dark") {
          result.push(`.nextly-admin.dark{${rest}`);
          continue;
        }

        // Skip if already has .nextly-admin
        if (selector.includes(".nextly-admin")) {
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
