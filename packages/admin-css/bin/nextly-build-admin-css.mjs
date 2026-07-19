#!/usr/bin/env node
/**
 * Compile a plugin's Tailwind CSS entry into a `.nextly-admin`-scoped,
 * minified stylesheet the plugin ships as `admin.styles`.
 *
 * Usage: nextly-build-admin-css <input.css> <output.css>
 *
 * Steps mirror the admin's own build (one scoper, one behavior): compile with
 * the Tailwind CLI, scope every rule under `.nextly-admin`, refuse to emit if
 * any rule escaped the wrapper (that would restyle the host page), then minify.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

import { checkAdminStyles, scopeCss } from "../src/index.mjs";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: nextly-build-admin-css <input.css> <output.css>");
  process.exit(1);
}

// Resolve the Tailwind CLI entry from admin-css's own dependency tree so the
// build does not depend on the caller having tailwind on PATH. The package only
// exports `./package.json`, so read its `bin` and resolve the executable next
// to it rather than importing a non-exported subpath.
const require = createRequire(import.meta.url);
const tailwindPkgJson = require.resolve("@tailwindcss/cli/package.json");
const tailwindBin = JSON.parse(fs.readFileSync(tailwindPkgJson, "utf-8")).bin;
const tailwindBinRel =
  typeof tailwindBin === "string" ? tailwindBin : tailwindBin.tailwindcss;
const tailwindCli = path.resolve(path.dirname(tailwindPkgJson), tailwindBinRel);
const runTailwind = args =>
  execFileSync(process.execPath, [tailwindCli, ...args], { stdio: "inherit" });

const outDir = path.dirname(path.resolve(output));
fs.mkdirSync(outDir, { recursive: true });
const rawFile = path.join(outDir, ".nextly-admin-css.raw.css");
const scopedFile = path.join(outDir, ".nextly-admin-css.scoped.css");

// Return an exit code instead of calling process.exit() here: process.exit()
// terminates immediately and skips the `finally` cleanup below, which would
// leave the unscoped `rawFile` in the output directory — the exact unscoped CSS
// a bundler must never pick up. The `finally` runs, then we exit at top level.
function run() {
  runTailwind(["-i", input, "-o", rawFile]);

  const scoped = scopeCss(fs.readFileSync(rawFile, "utf-8"));
  const issues = checkAdminStyles({ css: scoped }).filter(
    i => i.severity === "error"
  );
  if (issues.length > 0) {
    console.error(
      `Refusing to emit ${issues.length} issue(s):\n` +
        issues
          .slice(0, 5)
          .map(i => `  - ${i.message}`)
          .join("\n")
    );
    return 1;
  }

  fs.writeFileSync(scopedFile, scoped);
  runTailwind(["-i", scopedFile, "-o", output, "--minify"]);
  console.log(`✓ wrote scoped admin CSS → ${output}`);
  return 0;
}

let code = 1;
try {
  code = run();
} finally {
  for (const f of [rawFile, scopedFile]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}
process.exit(code);
