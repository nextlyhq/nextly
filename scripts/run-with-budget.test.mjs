/**
 * `run-with-budget.sh` exists to turn one specific silent state into a loud
 * one, so the cases that matter are the ones where it could go quiet again.
 *
 * The bug it removes: GitHub reports a `timeout-minutes` kill as
 * `conclusion: cancelled`, which no gate reads as a verdict, so an integration
 * leg that outgrows its ceiling stops reporting while looking like somebody
 * pressed cancel. Twice now that has cost real coverage on real merges.
 *
 * Two properties therefore carry the whole value, and each has a way of
 * passing for the wrong reason:
 *
 * - a budget overrun must EXIT NON-ZERO, and say so in words a reviewer can
 *   act on. A test that only checks the exit code would pass against a script
 *   that stayed silent, which is half the defect.
 * - an ordinary test failure must NOT be dressed up as a budget overrun. A
 *   test that only exercised the timeout path would pass against a script that
 *   printed "budget exceeded" for every non-zero exit, which would send the
 *   next person to raise a budget over a genuine red suite.
 *
 * A third case was REMOVED rather than repaired: it read a bare 137 as the
 * budget firing. That is no longer what the script does, because the runner's
 * out-of-memory killer produces 137 as well — so exit code alone cannot
 * separate them and elapsed time does. The two cases named "does NOT call an
 * early SIGKILL a budget overrun" and "DOES call a SIGKILL after the budget
 * elapsed an overrun" cover both directions of that split.
 *
 * And one property is the reason the script is a script at all: with no
 * `timeout` on PATH it must REFUSE rather than run the command unbounded.
 * Degrading quietly would reinstate exactly the state being removed while
 * looking like a guard — the failing-in-the-passing-direction shape.
 *
 * `timeout` is stubbed rather than used. Driving the real one means burning
 * wall-clock to observe a timeout, and the stub buys something the real binary
 * cannot: it records its own argv, so the tests can assert that the budget and
 * the command actually REACH it. Without that, a script that ignored its
 * arguments and ran the command bare would pass every exit-code assertion here.
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./run-with-budget.sh", import.meta.url));

/**
 * A directory holding ONLY the tools the script needs besides `timeout`.
 *
 * PATH is set to this and nothing else, so the script's own `awk`, `date` and
 * `sleep` resolve while `timeout` resolves only when a case supplies one. The
 * obvious alternative — appending `/bin:/usr/bin` — makes the "no `timeout`"
 * case find the REAL `/usr/bin/timeout` on every Ubuntu runner, run the command
 * through it, and pass or fail for reasons that have nothing to do with the
 * refusal being tested. That was live: it read as green on a Mac, which has no
 * `timeout`, and would have gone red on CI for the wrong reason.
 */
function toolsDir() {
  const dir = mkdtempSync(join(tmpdir(), "tools-"));
  for (const tool of ["awk", "date", "sleep"]) {
    const real = execFileSync("/bin/sh", ["-c", `command -v ${tool}`], {
      encoding: "utf8",
    }).trim();
    symlinkSync(real, join(dir, tool));
  }
  return dir;
}

/** A `timeout` that exits with whatever the case asks for, and records its argv. */
function stubDir(exitCode, sleepSeconds = 0) {
  const dir = mkdtempSync(join(tmpdir(), "budget-"));
  const argvLog = join(dir, "argv");
  const stub = join(dir, "timeout");
  writeFileSync(
    stub,
    // `#!/bin/sh`, not `#!/usr/bin/env sh`: PATH holds only this directory, so
    // `env` would have no `sh` to find and every case would exit 127.
    //
    // The sleep is how a case controls ELAPSED time, which is the only thing
    // that separates a budget that expired from a command killed by something
    // else — both exit 137.
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${argvLog}\nsleep ${sleepSeconds}\nexit ${exitCode}\n`
  );
  chmodSync(stub, 0o755);
  return { dir, argvLog };
}

/**
 * PATH is REPLACED, not prepended to.
 *
 * Prepending would leave the real `timeout` reachable on a machine that has
 * one, so the "no timeout on PATH" case would silently become "some other
 * timeout ran" — and it would pass, because that binary also exits non-zero
 * for a command it cannot find.
 */
function run(args, { path }) {
  try {
    // `/bin/sh` by absolute path: PATH below holds only the stub directory, so
    // resolving the shell THROUGH it would fail before the script ever ran —
    // and fail identically in every case, which reads as seven passing
    // refusals rather than a broken harness.
    const stdout = execFileSync("/bin/sh", [SCRIPT, ...args], {
      // The case's directory first, then the tools the script needs — and no
      // system directory at all, so a real `timeout` can never be found by
      // accident. `/bin/sh` itself is invoked by absolute path for the same
      // reason.
      env: { PATH: `${path}:${toolsDir()}` },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output: stdout };
  } catch (error) {
    return {
      status: error.status,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    };
  }
}

const BUDGET_ERROR = "::error title=Integration budget exceeded::";

describe("run-with-budget.sh", () => {
  it("passes a successful command straight through, saying nothing", () => {
    const { dir } = stubDir(0);
    const result = run(["55m", "the suite", "anything"], { path: dir });

    expect(result.status).toBe(0);
    expect(result.output).not.toContain(BUDGET_ERROR);
  });

  it("hands `timeout` the budget and the command, rather than running it bare", () => {
    const { dir, argvLog } = stubDir(0);
    run(["55m", "the suite", "pnpm", "lane:test:integration:mysql"], {
      path: dir,
    });

    // The order matters as much as the presence: `--kill-after` before the
    // duration, then the command. A script that passed the budget as an
    // argument to `pnpm` would still "contain" every one of these.
    expect(readFileSync(argvLog, "utf8").split("\n").slice(0, 4)).toEqual([
      "--kill-after=2m",
      "55m",
      "pnpm",
      "lane:test:integration:mysql",
    ]);
  });

  it("fails LOUDLY when the budget fires, naming what overran", () => {
    const { dir } = stubDir(124);
    const result = run(["55m", "the MySQL integration suite", "anything"], {
      path: dir,
    });

    expect(result.status).toBe(124);
    expect(result.output).toContain(BUDGET_ERROR);
    expect(result.output).toContain("the MySQL integration suite");
    expect(result.output).toContain("55m");
  });

  it("does NOT call an ordinary test failure a budget overrun", () => {
    const { dir } = stubDir(3);
    const result = run(["55m", "the suite", "anything"], { path: dir });

    expect(result.status).toBe(3);
    expect(result.output).not.toContain(BUDGET_ERROR);
  });

  it("refuses rather than running unbounded when there is no `timeout`", () => {
    // An empty directory as the case's own, so PATH holds the tools and nothing
    // that could resolve `timeout`. On a runner with `/usr/bin/timeout` the old
    // PATH found it, ran `anything` through it, and exited 127 — a red that
    // said nothing about the refusal.
    const empty = mkdtempSync(join(tmpdir(), "no-timeout-"));
    const result = run(["55m", "the suite", "anything"], { path: empty });

    expect(result.status).toBe(2);
    expect(result.output).toContain("refusing to run unbounded");
  });

  it("refuses a budget of zero, which DISABLES the timeout", () => {
    // GNU `timeout` documents 0 as disabling the bound, so `0m` would run the
    // command unbounded while the workflow, the env var and this wrapper all
    // still read as bounded.
    const { dir } = stubDir(0);
    const result = run(["0m", "the suite", "anything"], { path: dir });

    expect(result.status).toBe(2);
    expect(result.output).toContain("disables the timeout");
  });

  it("refuses a duration it cannot read, rather than guessing one", () => {
    const { dir } = stubDir(0);
    const result = run(["soon", "the suite", "anything"], { path: dir });

    expect(result.status).toBe(2);
    expect(result.output).toContain("cannot read");
  });

  it("does NOT call an early SIGKILL a budget overrun", () => {
    // The runner's out-of-memory killer also produces 137, on a command that
    // died in its first seconds. Reporting that as an overrun sends the next
    // person to raise a budget that was never the problem.
    const { dir } = stubDir(137);
    const result = run(["1h", "the MySQL integration suite", "anything"], {
      path: dir,
    });

    expect(result.status).toBe(137);
    expect(result.output).not.toContain(BUDGET_ERROR);
    expect(result.output).toContain("killed by SIGKILL");
  });

  it("DOES call a SIGKILL after the budget elapsed an overrun", () => {
    // The other side of the same discrimination: a TERM-ignoring worker killed
    // by the escalation, which is a real overrun and must stay loud.
    const { dir } = stubDir(137, 2);
    const result = run(["1s", "the suite", "anything"], { path: dir });

    expect(result.status).toBe(137);
    expect(result.output).toContain(BUDGET_ERROR);
  });

  it("refuses a call that names no command to run", () => {
    const { dir } = stubDir(0);
    const result = run(["55m", "the suite"], { path: dir });

    expect(result.status).toBe(2);
    expect(result.output).toContain("usage");
  });
});
