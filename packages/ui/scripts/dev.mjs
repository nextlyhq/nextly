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
 * ## No shell, so the child IS the watcher
 *
 * `spawn("tsup", …, { shell: true })` is the obvious way to find the binary, and it makes the
 * spawned process the SHELL rather than tsup. Killing it then kills `/bin/sh` or `cmd.exe` and can
 * leave the watcher underneath running — so a failure in one watcher would tear down its sibling's
 * shell while the sibling kept writing into `dist`, and Ctrl-C would leave processes behind.
 *
 * Resolving tsup's own entry and running it under this same Node removes the intermediary: the
 * process this file holds a handle to is the one doing the work, `kill()` reaches it directly, and
 * nothing depends on how a platform's shell resolves a name or forwards a signal.
 *
 * ## Any exit is a failure, including a clean one
 *
 * These are watchers. They are meant to run until the developer stops them, so a watcher that
 * returns 0 has still stopped rebuilding artifacts, and forwarding that 0 would report SUCCESS to
 * the surrounding pnpm and turbo pipeline while every output silently went stale. That is the same
 * half-working state this file exists to expose, reintroduced one layer up.
 *
 * The logging is unconditional for the same reason. Logging only on a non-zero code leaves the
 * clean exit — the case hardest to notice and easiest to misread as intentional — silent.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(packageRoot, "package.json"));

/**
 * The file tsup's `tsup` command actually runs.
 *
 * Read from the package's own manifest rather than assumed, because the path is tsup's to change
 * between versions and a hard-coded one would break on an upgrade with a `MODULE_NOT_FOUND` that
 * names this file instead of the cause.
 */
function tsupEntry() {
  const manifestPath = require.resolve("tsup/package.json");
  const { bin } = require(manifestPath);
  const relative = typeof bin === "string" ? bin : bin?.tsup;
  if (typeof relative !== "string") {
    throw new Error(
      "tsup's manifest declares no `tsup` binary, so there is nothing to run. Its `bin` field is " +
        `${JSON.stringify(bin)}.`
    );
  }
  return join(dirname(manifestPath), relative);
}

/**
 * The watchers, and what each one produces.
 *
 * Named so a failure says which output stopped being rebuilt. "the server-safe watcher exited" is
 * actionable in a way that a bare exit code is not.
 */
/**
 * `--watch src`, not a bare `--watch`.
 *
 * tsup's default watch root is the package directory, and from there it notices nothing: measured
 * on this package, an edit to `src/lib/color/index.ts` produced no rebuild and the artifact was
 * byte-identical 25 seconds later. Pointing the root at `src` makes the same edit rebuild.
 *
 * The failure it removes is silent, which is why the argument is worth a comment: the watcher
 * prints `Watching for changes in "."` and keeps running, so a contributor has positive evidence
 * that it works while consuming a `dist` that stopped changing.
 */
const WATCHERS = [
  { label: "client", args: ["--watch", "src"] },
  {
    label: "server-safe",
    args: ["--config", "tsup.server-safe.config.ts", "--watch", "src"],
  },
];

const entry = tsupEntry();
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
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: packageRoot,
    stdio: "inherit",
  });
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
