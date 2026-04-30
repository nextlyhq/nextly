#!/usr/bin/env node

/**
 * CSS watch script for the admin dev loop.
 *
 * Watches every file Tailwind v4 ingests when building admin's stylesheet:
 *   - src/styles/**\/*.css       — admin's own globals.css (source of truth
 *                                  for @theme tokens, @custom-variant, etc.)
 *   - src/**\/*.{ts,tsx}         — class names referenced by admin code
 *   - ../ui/src/**\/*.{ts,tsx}   — class names from @revnixhq/ui, pulled in
 *                                  via `@source "../../../ui/src"` in
 *                                  src/styles/globals.css
 *
 * On change, debounces 120ms and re-runs scripts/build-css.mjs (which
 * compiles + applies the .adminapp scoping post-process + minifies into
 * dist/styles/globals.css). Consumers (apps/playground) consume the dist
 * file via the existing Turbopack alias, so a fresh dist triggers their
 * HMR without any other coupling.
 *
 * Run alone: `node scripts/build-css-watch.mjs`
 * Run as part of admin dev: scripts/dev.mjs spawns this alongside
 * `tsup --watch`.
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

import chokidar from "chokidar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const buildScript = path.join(__dirname, "build-css.mjs");

let isBuilding = false;
let pending = false;

function build(reason) {
  if (isBuilding) {
    pending = true;
    return;
  }
  isBuilding = true;
  console.log(`\n[admin:css] rebuild (${reason})`);

  const proc = spawn("node", [buildScript], {
    cwd: rootDir,
    stdio: "inherit",
  });

  proc.on("exit", code => {
    isBuilding = false;
    if (code !== 0) {
      console.error(`[admin:css] build failed with exit code ${code}`);
    }
    if (pending) {
      pending = false;
      build("queued change");
    }
  });
}

build("initial");

const watcher = chokidar.watch(
  [
    "src/styles/**/*.css",
    "src/**/*.{ts,tsx}",
    "../ui/src/**/*.{ts,tsx}",
  ],
  {
    cwd: rootDir,
    ignoreInitial: true,
    ignored: /(^|[/\\])(node_modules|dist)([/\\]|$)/,
  }
);

let timer = null;
watcher.on("all", (event, file) => {
  clearTimeout(timer);
  timer = setTimeout(() => build(`${event}: ${file}`), 120);
});

console.log("[admin:css] watching for changes...");
