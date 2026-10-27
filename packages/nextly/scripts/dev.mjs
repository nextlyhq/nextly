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

import { treeKillCommand } from "../../../scripts/pnpm-invocation.mjs";
import { announcementReader } from "../../../scripts/watch-readiness.mjs";

/** tsc's line once a pass is written, whether or not it found errors. */
const PASS_WRITTEN = "Watching for file changes";

const children = [];
let stopping = false;

/**
 * Start one long-lived producer. Any exit is a failure, a clean one included:
 * these run until the developer stops them, and a watcher that has returned
 * has stopped updating `dist` while the others carry on.
 */
function start(label, [command, ...args], onOutput) {
  const stdio = ["ignore", onOutput ? "pipe" : "inherit", "inherit"];
  // On POSIX the watcher is spawned directly, with no shell between: the
  // handle is then the watcher itself (pnpm's shim for `tsc` and `tsdown`
  // ends in `exec node`), so a signal to it stops the watcher. Behind a shell,
  // whether the signal reached the command depended on the shell replacing
  // itself, which not every `/bin/sh` does. Windows needs `cmd.exe` to run the
  // `.cmd` shims, given one command string because Node deprecates arguments
  // beside `shell: true`; there `stop` ends the whole tree.
  const child =
    process.platform === "win32"
      ? spawn([command, ...args].join(" "), { stdio, shell: true })
      : spawn(command, args, { stdio });
  if (onOutput) {
    // Decoded as a stream, so a character split between two chunks arrives
    // whole in the second rather than as two broken halves.
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      process.stdout.write(chunk);
      onOutput(chunk);
    });
  }
  child.on("exit", code =>
    fail(`the ${label} watcher exited (code ${code ?? "null"})`, code)
  );
  // A watcher that could not be started at all (its command missing, too many
  // open files) reports `error` and no `exit`. Unhandled, that event ends this
  // process without stopping the watchers already running, which go on
  // writing into `dist`; so it fails the same way an exit does.
  child.on("error", error =>
    fail(`the ${label} watcher could not run (${error.message})`, 1)
  );
  children.push(child);
}

start("javascript", ["tsdown", "--watch"]);

// The bundler starts on the first pass tsc reports, read across chunks: the
// line can arrive split between two of them.
const passWritten = announcementReader(PASS_WRITTEN);
let bundling = false;
start(
  "declarations",
  ["tsc", "-p", "tsconfig.dts.json", "--watch", "--preserveWatchOutput"],
  output => {
    if (bundling || !passWritten(output)) return;
    bundling = true;
    start("declaration bundle", [
      "tsdown",
      "-c",
      "tsdown.dts.config.ts",
      "--watch",
    ]);
  }
);

/**
 * One watcher has stopped or never started: stop the others, then exit
 * non-zero, once however many of them report.
 */
function fail(what, code) {
  if (stopping) return;
  console.error(
    `[nextly] ${what}; stopping the others, because dist is no longer being rebuilt.`
  );
  stopAll().then(() => process.exit(code === 0 || code === null ? 1 : code));
}

/**
 * Stop one watcher, and everything under it. On Windows the handle is the
 * `cmd.exe` that `shell: true` put in between, so killing it would leave the
 * watcher itself running and writing into `dist`; `treeKillCommand` supplies
 * the tree kill that reaches it, and is null on POSIX, where the handle is the
 * watcher. A tree kill that cannot run falls back to the
 * handle rather than leaving the stop unanswered.
 */
function stop(child) {
  return new Promise(resolve => {
    const treeKill = treeKillCommand(child.pid);
    if (!treeKill) {
      child.kill();
      resolve();
      return;
    }
    const killer = spawn(treeKill.command, treeKill.args, { stdio: "ignore" });
    killer.on("error", () => {
      child.kill();
      resolve();
    });
    killer.on("exit", code => {
      if (code !== 0) child.kill();
      resolve();
    });
  });
}

function stopAll() {
  stopping = true;
  return Promise.all(
    children
      // A watcher that never started has no process, and nothing to stop.
      .filter(
        child =>
          child.pid !== undefined &&
          child.exitCode === null &&
          child.signalCode === null
      )
      .map(stop)
  );
}

// Ctrl-C reaches this process; the children are separate and have to be told.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopAll().then(() => process.exit(0));
  });
}
