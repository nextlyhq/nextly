#!/usr/bin/env node

/**
 * CSS watch script for the admin dev loop.
 *
 * Watches the source trees Tailwind v4 ingests when building admin's
 * stylesheet:
 *   - src/                           (admin's globals.css + .ts(x)
 *                                     class-name source — Tailwind v4
 *                                     scans the package's own source
 *                                     by default)
 *   - ../ui/src/                     (.ts(x) class names from
 *                                     @revnixhq/ui, pulled in via the
 *                                     `@source "../../../ui/src"`
 *                                     directive in admin's globals.css)
 *
 * On change, debounces 120ms and calls buildCssFast() in-process. The
 * Tailwind PostCSS plugin holds its content-scan cache between calls
 * so hot rebuilds finish in ~50ms (vs the 16-40s spawn-based path
 * that build-css.mjs uses for production builds).
 *
 * Run alone: `node scripts/build-css-watch.mjs`
 * Run as part of admin dev: scripts/dev.mjs spawns this alongside
 * `tsup --watch`.
 */

import path from "path";
import { fileURLToPath } from "url";

import chokidar from "chokidar";

import { buildCssFast } from "./build-css-fast.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

let isBuilding = false;
let pending = false;

async function build(reason) {
  if (isBuilding) {
    pending = true;
    return;
  }
  isBuilding = true;
  try {
    const { ms, sizeKB } = await buildCssFast();
    console.log(`[admin:css] ${reason} → ${sizeKB} KB in ${ms}ms`);
  } catch (err) {
    console.error(`[admin:css] build failed (${reason}):`, err);
  } finally {
    isBuilding = false;
    if (pending) {
      pending = false;
      build("queued change");
    }
  }
}

await build("initial");

// chokidar 4+ removed bundled glob support — pass directories and
// filter in the `ignored` callback. Watching the two trees Tailwind
// v4 scans is enough; the post-process scoping is pure JS and runs
// inside buildCssFast.
const watchPaths = [
  path.join(rootDir, "src"),
  path.resolve(rootDir, "../ui/src"),
];

const SOURCE_FILE_RE = /\.(css|tsx?)$/i;

const watcher = chokidar.watch(watchPaths, {
  ignoreInitial: true,
  ignored: (testPath, stats) => {
    if (/(^|[/\\])(node_modules|dist)([/\\]|$)/.test(testPath)) {
      return true;
    }
    if (stats?.isFile()) {
      return !SOURCE_FILE_RE.test(testPath);
    }
    return false;
  },
});

let timer = null;
watcher.on("all", (event, file) => {
  clearTimeout(timer);
  timer = setTimeout(
    () => build(`${event}: ${path.relative(rootDir, file)}`),
    120
  );
});

watcher.on("ready", () => console.log("[admin:css] watching for changes..."));
watcher.on("error", err => console.error("[admin:css] watcher error:", err));
