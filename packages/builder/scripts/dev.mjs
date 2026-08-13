#!/usr/bin/env node

/**
 * Run this package's three watchers together, on every supported OS.
 *
 * `a & b & wait` is a POSIX shell construct. pnpm runs scripts through
 * `cmd.exe` on Windows, where `&` is a SEQUENTIAL separator and `wait` is not a
 * builtin at all — so the first watcher, which never exits by design, holds the
 * line for ever and the other two never start. A Windows contributor was
 * therefore left with exactly the stale artifacts the watchers exist to prevent:
 * the root entry, the server-safe subpaths and the stylesheet all frozen at
 * whatever the last full build produced, with no error to explain it.
 *
 * Node's `spawn` is the portable equivalent, and it is a dozen lines rather
 * than a dependency.
 *
 * Three producers, because this package publishes three kinds of artifact from
 * one `dist`: the client entry, the server-safe entries, and the compiled
 * stylesheet. Cleaning belongs to `build`, never here — a clean under `--watch`
 * would delete the other two producers' output on every rebuild.
 */

import { spawn } from "node:child_process";

/** Each long-lived producer, with a label for whose output is whose. */
const PRODUCERS = [
  { label: "client", args: ["tsup", "--watch"] },
  {
    label: "server-safe",
    args: ["tsup", "--config", "tsup.server-safe.config.ts", "--watch"],
  },
  { label: "css", args: ["pnpm", "run", "dev:css"] },
];

const children = PRODUCERS.map(({ label, args }) => {
  const [command, ...rest] = args;
  const child = spawn(command, rest, {
    stdio: "inherit",
    // Resolves `tsup` and `pnpm` through the platform's own lookup rules,
    // including the `.cmd` shims npm writes on Windows.
    shell: true,
  });
  child.on("exit", code => {
    // ANY exit is a failure here, including a clean one. These producers are
    // meant to run until the developer stops them, so a watcher that returns 0
    // — losing its input stream, say — has still stopped updating artifacts.
    // Forwarding that 0 told the surrounding pnpm/turbo pipeline the builder
    // task had SUCCEEDED while every artifact silently went stale, which is the
    // half-working state this runner exists to make visible.
    console.error(
      `[builder] the ${label} watcher exited (code ${code ?? "null"}); ` +
        `stopping the others, because artifacts are no longer being rebuilt.`
    );
    stopAll();
    process.exit(code === 0 || code === null ? 1 : code);
  });
  return child;
});

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
