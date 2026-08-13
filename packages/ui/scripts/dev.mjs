/**
 * Run this package's two build watchers together, on every platform.
 *
 * The script this replaces was `tsup --watch & tsup --config ... --watch & wait`, which is POSIX.
 * pnpm runs scripts through `cmd.exe` on Windows, where `&` separates commands SEQUENTIALLY and
 * `wait` is not a builtin — so the first watcher, which never exits by design, held the line and
 * the second never started.
 *
 * The reason that survived is the shape of its failure rather than its subtlety. Nothing errored:
 * a Windows contributor saw a dev server running, a healthy `dist/index.*`, and stale or absent
 * server-safe artifacts beside it. The thing they would check — is the dev script running? —
 * answered yes. Nothing observable at the point of use distinguished it from working.
 *
 * ## Any exit is a failure, including a clean one
 *
 * These are watchers. They are meant to run until the developer stops them, so a watcher that
 * returns 0 has still stopped rebuilding artifacts, and forwarding that 0 would report SUCCESS to
 * the surrounding pnpm and turbo pipeline while every output silently went stale. That is the same
 * half-working state this file exists to expose, reintroduced one layer up. A child exiting is
 * therefore always reported and always non-zero, whatever code it used.
 *
 * The logging is unconditional for the same reason. Logging only on a non-zero code leaves the
 * clean exit — the case hardest to notice and easiest to misread as intentional — silent.
 *
 * ## Why this is a runtime invariant rather than a startup check
 *
 * Both children are spawned explicitly, so "the second one never started" cannot recur in the
 * original form. What the exit handler adds is broader: at no point during the session may either
 * watcher be absent. A future edit that breaks one of them fails loudly at the moment it happens
 * rather than producing artifacts nobody rebuilt.
 */
import { spawn } from "node:child_process";

/**
 * The watchers, and what each one produces.
 *
 * Named so a failure says which output stopped being rebuilt. "the server-safe watcher exited" is
 * actionable in a way that a bare exit code is not.
 */
const WATCHERS = [
  { label: "client", args: ["--watch"] },
  {
    label: "server-safe",
    args: ["--config", "tsup.server-safe.config.ts", "--watch"],
  },
];

const children = [];
let stopping = false;

/**
 * Stop every watcher that is still running.
 *
 * Guarded by `stopping` because this runs from both the exit handler and the signal handlers, and
 * killing a child triggers the exit handler of its siblings — without the guard the first failure
 * cascades into a loop of teardowns reporting each other.
 */
function stopAll() {
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

for (const { label, args } of WATCHERS) {
  // `shell: true` so `tsup` resolves through the platform's own lookup, which on Windows means the
  // `.cmd` shim npm installs rather than an extensionless file that `spawn` alone cannot execute.
  const child = spawn("tsup", args, { stdio: "inherit", shell: true });
  children.push(child);

  child.on("error", error => {
    console.error(`[ui] the ${label} watcher could not start: ${error.message}`);
    stopAll();
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(
      `[ui] the ${label} watcher exited (code ${code ?? "null"}, signal ${signal ?? "none"}); ` +
        "stopping the others, because its artifacts are no longer being rebuilt."
    );
    stopAll();
    // Never the child's own code: 0 would tell the pipeline this task succeeded while the outputs
    // it exists to produce have stopped changing.
    process.exit(code === 0 || code === null ? 1 : code);
  });
}

// Ctrl-C reaches this process, not the children, so they are told separately. Without this they
// outlive the terminal that started them and keep writing into `dist`.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopAll();
    process.exit(0);
  });
}
