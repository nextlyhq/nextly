#!/usr/bin/env node

/**
 * The bounded local verification entry points.
 *
 * 🔴 These were `package.json` one-liners using `TURBO_CONCURRENCY=${VAR:-2}
 * turbo ... && ...`. That spelling is POSIX shell: on Windows outside a
 * bash-alike, `${VAR:-2}` is not expanded and the assignment prefix is not a
 * thing, so the command either fails or — worse — runs with the literal string
 * as the concurrency and turbo falls back to its default of 10. A gate that
 * silently unbounds itself on one operating system is the failure this whole
 * file exists to prevent, wearing a different costume.
 *
 * Node runs identically on every platform this repository is developed on, so
 * the sequencing and the limits live here instead.
 *
 * Phases run SEQUENTIALLY and the first failure stops the run. They are not
 * independent: `check-types` reads what `build` produced, so running them
 * together reports a missing `dist` as a type error in the diff.
 *
 * `quick` is the check before a merge into `dev`: the types of the packages a
 * branch affects (each one it changes and each one that depends on them, as
 * turbo's `--affected` answers it), then the unit tests of the packages it
 * changes, narrowed to the test files the change can reach by
 * `scripts/test-changed.mjs`, the pre-push's own selection. Both compare with
 * the merge base of `origin/dev` unless another base is named.
 *
 * Usage:
 *   node scripts/verify.mjs pr
 *   node scripts/verify.mjs full
 *   node scripts/verify.mjs quick [base]
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { INTEGRATION_BASE } from "./integration-branch.mjs";
import { localLimits } from "./local-limits.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What each scope runs, in order.
 *
 * `full` extends `pr` rather than restating it, so the two cannot drift into
 * disagreeing about what a PR needs.
 */
export function phasesFor(scope, limits, base = INTEGRATION_BASE) {
  const workers = `--maxWorkers=${limits.maxWorkers}`;
  if (scope === "quick") return quickPhases(limits, base);
  const pr = [
    { name: "build", argv: ["turbo", "run", "build"] },
    // Lint is the root script, one oxlint run in passes rather than a turbo
    // task, so it is its own phase. It runs after the build, because its
    // type-aware rules read the siblings' `dist`.
    { name: "lint", argv: ["run", "lint"] },
    { name: "types", argv: ["turbo", "run", "check-types", "--continue"] },
    { name: "unit tests", argv: ["turbo", "run", "test", "--continue", "--", workers] },
    // `turbo run test` does not reach `scripts/` — gate-scope.mjs records that
    // explicitly — so without this a change confined to the repository's own
    // tooling passes both documented entry points without running its tests.
    //
    // vitest is invoked DIRECTLY rather than through `pnpm run test:scripts`,
    // and the reason is measurable rather than stylistic. `pnpm run <script> --
    // <args>` forwards the arguments but KEEPS the separator, so the script
    // runs as `vitest run --dir scripts -- --maxWorkers=2` and vitest reads
    // everything after `--` as a test-name filter rather than as options. The
    // cap is silently ignored and the run reports success, so the phase looks
    // bounded and is not. Verified with a deliberately invalid flag: through
    // `pnpm run ... --` it is accepted and ignored; passed directly it is
    // rejected with `Unknown option`.
    //
    // turbo's `--` behaves the opposite way and does forward options, which is
    // why the phases above can keep using it.
    //
    // `test:scripts` is exactly this command with no wrapper of its own, so
    // nothing is bypassed by going direct.
    { name: "script tests", argv: ["exec", "vitest", "run", "--dir", "scripts", workers] },
  ];
  if (scope === "pr") return pr;
  return [
    ...pr,
    { name: "repo-wide lints", argv: ["run", "lint:design"] },
    { name: "workspace lint", argv: ["run", "lint:workspace"] },
    { name: "script lint", argv: ["run", "lint:scripts"] },
    // Invoked as turbo directly rather than through `test:integration:sqlite`,
    // which is exactly `turbo run test:integration` with no environment of its
    // own — the sqlite leg needs no connection URL. Going direct is what lets
    // the worker cap be forwarded; appending it to the script would hand
    // `--maxWorkers` to turbo, which does not know the flag.
    //
    // The integration configs already pin `singleFork: true`, so this changes
    // nothing at runtime. It makes the bound VERIFIABLE rather than resting on
    // a config the checker does not read.
    { name: "integration (sqlite)", argv: ["turbo", "run", "test:integration", "--", workers] },
  ];
}

/**
 * The quick check's phases. The packages are built first, as `pnpm build`
 * builds them (replayed from turbo's cache when nothing changed them), since a
 * typecheck read against a missing or stale `dist` answers about code that is
 * not there. `--affected` is not used for the build: it would also build the
 * apps that depend on a changed package, and the playground's build is a whole
 * `next build`. The typecheck then runs with `--only`, as the
 * pre-push's does: its verdict covers the affected packages, and a red in an
 * unchanged dependency is that package's owner's, not this branch's. At most
 * two test workers, whatever the machine allows, so the check stays light
 * enough to run before every merge.
 */
function quickPhases(limits, base) {
  const workers = Math.min(2, limits.maxWorkers);
  const scm = { TURBO_SCM_BASE: base };
  return [
    { name: "build", argv: ["turbo", "run", "build", "--filter=./packages/*"] },
    { name: "types (affected)", argv: ["turbo", "run", "check-types", "--affected", "--only", "--continue"], env: scm },
    { name: "unit tests (changed)", argv: ["exec", "node", "scripts/test-changed.mjs", base, `--max-workers=${workers}`] },
  ];
}

/**
 * The commit the quick check compares with, named before it runs. The base is
 * the local copy of the target branch, which only a fetch moves: compared with
 * a stale one, a package the target has since changed reads as this branch's
 * change and one this branch changed can be missed. Nothing is fetched here,
 * since a fork may track the target under another remote and the base may be
 * any ref; the line says which commit was used and how to refresh it.
 */
export function describeBase(base, git = args => spawnSync("git", args, { cwd: root, encoding: "utf8" })) {
  const read = git(["log", "-1", "--format=%h, committed %cr", base, "--"]);
  if (read.status !== 0 || !read.stdout.trim()) {
    return `verify (quick): ${base} cannot be read; fetch the branch this merges into and name it, e.g. \`pnpm check:quick origin/dev\``;
  }
  return `verify (quick): comparing with ${base} (${read.stdout.trim()}); \`git fetch origin dev\` first if that is not the current target`;
}

function run(argv, limits, env = {}) {
  // `shell` on Windows because the launcher is `pnpm.cmd` there and Node will
  // not execute it directly. Everywhere else it stays off, so no argument
  // passes through a shell that could reinterpret it.
  const result = spawnSync("pnpm", argv, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      // turbo's own variable, so it reaches every nested invocation.
      TURBO_CONCURRENCY: String(limits.concurrency),
      ...env,
    },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function main() {
  const scope = process.argv[2];
  if (scope !== "pr" && scope !== "full" && scope !== "quick") {
    console.error("verify: usage — node scripts/verify.mjs pr|full|quick [base]");
    process.exit(2);
  }
  const base = process.argv[3] ?? INTEGRATION_BASE;

  const limits = localLimits();
  console.log(
    `verify (${scope}): ${limits.concurrency} package task(s) x ${limits.maxWorkers} worker(s)` +
      `${limits.overridden ? " (overridden)" : ""} on ${limits.totalGiB} GiB / ${limits.cpus} cpu(s)\n`
  );

  if (scope === "quick") console.log(describeBase(base));

  const started = Date.now();
  for (const phase of phasesFor(scope, limits, base)) {
    console.log(`\n--- ${phase.name} ---`);
    const status = run(phase.argv, limits, phase.env);
    if (status !== 0) {
      // Name the phase. A bare non-zero exit from a seven-phase run sends the
      // reader to the top of a very long log to work out which one it was.
      console.error(`\nverify (${scope}): FAILED at '${phase.name}' (exit ${status})`);
      process.exit(status);
    }
  }

  console.log(`\nverify (${scope}): OK in ${Math.round((Date.now() - started) / 1000)}s`);
}

if (process.argv[1] && process.argv[1].endsWith("verify.mjs")) {
  main();
}
