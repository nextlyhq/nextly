#!/usr/bin/env node

/**
 * Run this package's three watchers together, on every supported OS.
 *
 * Three producers, because `build` makes `dist` in three steps: tsdown writes
 * the JavaScript, `tsc -p tsconfig.dts.json` writes one declaration file per
 * source file to `.dts-tmp`, and `tsdown -c tsdown.dts.config.ts` bundles
 * those into the published `.d.mts`. With the declarations outside tsdown's
 * own build, a plain `tsdown --watch` would keep only the first current, and
 * every package that resolves `nextly` through `dist` would type-check against
 * declarations from the last full build.
 *
 * The bundler starts once tsc has written its first pass, which tsc announces
 * with "Watching for file changes": its entries are files in `.dts-tmp`, and a
 * bundler watching them while that pass writes all of them rebuilds once per
 * file. Cleaning belongs to `build`, never here, because a clean under a watch
 * deletes the other producers' output.
 *
 * Node's `spawn` rather than `a & b & wait`: pnpm runs scripts through
 * `cmd.exe` on Windows, where `&` runs its commands one after another and the
 * first watcher never returns.
 */

import { spawn } from "node:child_process";

/** tsc's line once a pass is written, whether or not it found errors. */
const PASS_WRITTEN = /Watching for file changes/;

const children = [];

/**
 * Start one long-lived producer. Any exit is a failure, a clean one included:
 * these run until the developer stops them, and a watcher that has returned
 * has stopped updating `dist` while the others carry on.
 */
function start(label, command, onOutput) {
  // One command string, not a command and arguments: the shell resolves
  // `tsdown` and `tsc` through the platform's own lookup rules, including the
  // `.cmd` shims npm writes on Windows, and Node deprecates passing arguments
  // alongside `shell: true`.
  const child = spawn(command, {
    stdio: ["ignore", onOutput ? "pipe" : "inherit", "inherit"],
    shell: true,
  });
  if (onOutput) {
    child.stdout.on("data", chunk => {
      process.stdout.write(chunk);
      onOutput(String(chunk));
    });
  }
  child.on("exit", code => {
    console.error(
      `[nextly] the ${label} watcher exited (code ${code ?? "null"}); ` +
        `stopping the others, because dist is no longer being rebuilt.`
    );
    stopAll();
    process.exit(code === 0 || code === null ? 1 : code);
  });
  children.push(child);
}

start("javascript", "tsdown --watch");

let bundling = false;
start(
  "declarations",
  "tsc -p tsconfig.dts.json --watch --preserveWatchOutput",
  output => {
    if (bundling || !PASS_WRITTEN.test(output)) return;
    bundling = true;
    start("declaration bundle", "tsdown -c tsdown.dts.config.ts --watch");
  }
);

function stopAll() {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

// Ctrl-C reaches this process; the children are separate and have to be told.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopAll();
    process.exit(0);
  });
}
