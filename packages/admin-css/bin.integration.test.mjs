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
const COMPILE_TIMEOUT_MS = CHILD_TIMEOUT_MS + 30_000;

/** Run the CLI, killing the whole process tree if it outlives its budget. */
function compile(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", chunk => (stderr += chunk));
    const timer = setTimeout(() => {
      // The negative pid addresses the GROUP. Wrapped because the group is gone
      // already when the child exits between the timer firing and this call.
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
      reject(new Error(`compile exceeded ${String(CHILD_TIMEOUT_MS)}ms`));
    }, CHILD_TIMEOUT_MS);
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
