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

import {
  findUnscopedRules,
  namespaceInternalProperties,
  prefixKeyframes,
  scopeCss,
} from "@nextlyhq/admin-css";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Prefix for the names this sheet publishes document-wide.
 *
 * Short and shared by both namespacing passes, so a keyframe and a custom
 * property that came from the same build are recognisable as one origin.
 */
const NAME_PREFIX = "nx-";
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

  // Scoping selectors is not the whole job. Two kinds of name in this sheet are
  // resolved for the whole DOCUMENT no matter which selector accompanies them,
  // so a perfectly scoped stylesheet still reaches the host through them.
  //
  // `@keyframes` names are global: this sheet defines `spin`, `pulse` and
  // `fade-in`, and a host that defines its own gets whichever loaded later.
  //
  // `@property` registrations are global too, and worse, because registering a
  // name changes its semantics everywhere — an inherited custom property
  // becomes non-inheriting and gains an initial value. A host running Tailwind
  // itself registers the same `--tw-*` names, and the two registrations are
  // not required to agree.
  css = prefixKeyframes(css, NAME_PREFIX);
  css = namespaceInternalProperties(css, NAME_PREFIX);

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

  // Step 5: Guard the naming invariant, for the same reason and on the same
  // terms. A selector that escapes restyles the host page; a NAME that escapes
  // is resolved for the whole document and changes what the host's own rules
  // mean. Reading the built file rather than the in-memory string, because the
  // minifier runs between them and the file is what ships.
  const built = fs.readFileSync(outputFile, "utf-8");
  const escapedNames = [
    ...[
      ...built.matchAll(/@(?:-webkit-)?keyframes\s+("[^"]*"|'[^']*'|[\w-]+)/gi),
    ]
      .map(match => match[1].replace(/^["']|["']$/g, ""))
      .filter(name => !name.startsWith(NAME_PREFIX))
      .map(name => `@keyframes ${name}`),
    ...[...built.matchAll(/(?<![\w-])--tw-[\w-]+/g)].map(match => match[0]),
  ];
  if (escapedNames.length) {
    const unique = [...new Set(escapedNames)];
    console.error(
      `\n❌ ${unique.length} name(s) escaped the "${NAME_PREFIX}" namespace:\n`
    );
    for (const name of unique.slice(0, 20)) console.error("  " + name);
    console.error(
      "\nAnimation names and @property registrations resolve for the whole\n" +
        "document, so a host that uses the same name gets whichever sheet loaded\n" +
        "later. Both namespacing passes run before minification; a name here\n" +
        "means one of them missed a shape it should cover.\n"
    );
    process.exit(1);
  }

  // Step 6: Guard the same invariant from the other side. Steps 4 and 5 read
  // the stylesheet, and a keyframe name can also be written in JSX — an inline
  // `animation` style never passes through the rename above, so it silently
  // names a definition that no longer exists and the element just does not
  // animate. Nothing in the CSS can show that, so the source is checked too.
  const defined = new Set(
    [...built.matchAll(/@(?:-webkit-)?keyframes\s+("[^"]*"|'[^']*'|[\w-]+)/gi)]
      .map(match => match[1].replace(/^["']|["']$/g, ""))
      .map(name => name.slice(NAME_PREFIX.length))
  );
  const srcDir = path.join(rootDir, "src");
  const stale = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        const text = fs.readFileSync(full, "utf-8");
        // `animation: "<name> ..."` and `animationName: "<name>"`, the two
        // shapes an inline style can name a keyframe with.
        for (const m of text.matchAll(
          /animation(?:Name)?:\s*[`"']\s*([\w-]+)/g
        )) {
          const name = m[1];
          if (defined.has(name) && !name.startsWith(NAME_PREFIX)) {
            stale.push(`${path.relative(rootDir, full)}: ${name}`);
          }
        }
      }
    }
  };
  visit(srcDir);
  if (stale.length) {
    console.error(
      `\n❌ ${stale.length} inline style(s) name a keyframe that was namespaced:\n`
    );
    for (const entry of stale) console.error("  " + entry);
    console.error(
      `\nThe stylesheet defines these as "${NAME_PREFIX}<name>", so the\n` +
        "unprefixed name matches nothing and the animation silently does not\n" +
        "run. Prefix the name in the inline style.\n"
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
