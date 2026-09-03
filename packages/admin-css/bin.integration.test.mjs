/**
 * POC + contract test for the plugin admin-CSS build.
 *
 * A third-party plugin authors Tailwind against the shared token preset and
 * runs this CLI to produce its `admin.styles`. This proves the output is
 * scoped under `.nextly-admin`, token-referencing (not raw color), and free of
 * a re-emitted preflight reset (which would restyle the host page) — the
 * properties the loading + isolation model depends on.
 */
import { spawn } from "node:child_process";
// Imported rather than taken from the global scope: this file lints under a
// config that supplies `setTimeout` and not `clearTimeout`, and a timer that is
// set but never cleared keeps the worker alive after the case has passed.
import { clearTimeout, setTimeout } from "node:timers";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { findUnscopedRules } from "./src/index.mjs";

// import.meta.dirname requires Node 20.11+, above the repo's Node >=20 floor.
const ROOT = path.dirname(fileURLToPath(import.meta.url));

/*
 * This case spawns a Node process that runs the Tailwind CLI over a real
 * stylesheet, so its cost is a process start plus a compile rather than the
 * microseconds an in-process assertion takes. vitest's default 5s budget is
 * sized for the latter: measured on a CI runner the compile alone reported
 * 630ms while the case took 5547ms end to end and was killed at the limit,
 * having done nothing wrong.
 *
 * Run ASYNCHRONOUSLY, and killed as a process GROUP, for two reasons that a
 * synchronous call cannot satisfy at once:
 *
 *   - `execSync` blocks the worker's event loop for as long as the child runs,
 *     and a timer that cannot be serviced cannot fire. Against a child that
 *     HANGS the case budget is inert: measured, a child sleeping 20s under a 5s
 *     budget ran the full 20032ms before the case failed.
 *   - node's own `timeout` option signals the DIRECT child only. The CLI runs
 *     Tailwind as a nested process, so that kill leaves the compiler alive and
 *     reparented to init, still consuming the runner through later steps —
 *     measured: the outer call returns `ETIMEDOUT` while the nested process
 *     survives.
 *
 * `detached` makes the child a group leader, so `process.kill(-pid)` reaches
 * the compiler beneath it, and awaiting rather than blocking leaves the loop
 * free for the case budget below to act as a second bound.
 */
const CHILD_TIMEOUT_MS = 60_000;
/** Enough of a failing compile's output to diagnose it, bounded so a noisy hang cannot grow it without limit. */
const STDERR_TAIL_BYTES = 16_384;
const COMPILE_TIMEOUT_MS = CHILD_TIMEOUT_MS + 30_000;

/** Run the CLI, killing the whole process tree if it outlives its budget. */
function compile(args, cwd, timeoutMs = CHILD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Drained continuously so the pipe never fills and stalls the child, but
    // only the TAIL is retained: a compiler failing noisily can emit for as long
    // as the bound allows, and keeping every byte to build one error message
    // lets the worker exhaust its heap before the bound it was waiting for.
    let stderr = "";
    child.stderr.on("data", chunk => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL_BYTES);
    });
    const timer = setTimeout(() => {
      // The negative pid addresses the GROUP. Wrapped because the group is gone
      // already when the child exits between the timer firing and this call.
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
      reject(new Error(`compile exceeded ${String(timeoutMs)}ms`));
    }, timeoutMs);
    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`exited ${String(code)}: ${stderr}`));
    });
  });
}

describe("nextly-build-admin-css (POC)", () => {
  it(
    "compiles a plugin entry to scoped, token-driven CSS",
    async () => {
      const out = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), "nx-poc-")),
        "admin.css"
      );
      await compile(
        [
          `${ROOT}/bin/nextly-build-admin-css.mjs`,
          `${ROOT}/__fixtures__/poc-plugin/admin.css`,
          out,
        ],
        ROOT
      );
      const css = fs.readFileSync(out, "utf-8");

      // Scoped: no rule escapes the wrapper.
      expect(findUnscopedRules(css)).toEqual([]);
      // No preflight reset re-emitted (that universal selector would restyle host).
      expect(css).not.toMatch(/\*,\s*::before,\s*::after/);
      // The fixture's utilities are present and token-driven.
      expect(css).toContain(".nextly-admin");
      expect(css).toMatch(/var\(--/);
    },
    COMPILE_TIMEOUT_MS
  );
});

/*
 * The timeout branch, which the compile case above never reaches.
 *
 * Without this the helper's kill could regress to signalling the wrapper alone
 * and every other case here would still pass — the failure it exists to prevent
 * is invisible to a suite whose only invocation succeeds.
 *
 * Asserted through the FILESYSTEM rather than a process table: the nested child
 * writes one file when it starts and another when it finishes, so "was it
 * killed" becomes "did the second file never appear". That needs no `pgrep`,
 * no pid arithmetic, and behaves the same wherever the suite runs.
 */
describe("the compile timeout", () => {
  const HANG = path.join(ROOT, "__fixtures__", "hang");
  // The child outlives its bound by enough that a surviving process would
  // certainly have finished before the assertion, and no longer.
  const CHILD_SLEEP_MS = 3_000;
  const BOUND_MS = 500;

  it("kills the NESTED process, not only the wrapper it signalled", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nx-hang-"));
    const started = path.join(dir, "started");
    const finished = path.join(dir, "finished");

    await expect(
      compile(
        [
          path.join(HANG, "wrapper.mjs"),
          started,
          finished,
          String(CHILD_SLEEP_MS),
        ],
        ROOT,
        BOUND_MS
      )
    ).rejects.toThrow(/exceeded/);

    // Must-be-found: the nested child really ran, so its absence below is a
    // kill rather than a fixture that never started.
    expect(
      fs.existsSync(started),
      "the nested child never started, so this case proves nothing about killing it"
    ).toBe(true);

    // Past the point it would have finished had it survived.
    await new Promise(resolve => setTimeout(resolve, CHILD_SLEEP_MS));

    expect(
      fs.existsSync(finished),
      "the nested child outlived the kill aimed at its parent's process group"
    ).toBe(false);
  }, 30_000);
});
