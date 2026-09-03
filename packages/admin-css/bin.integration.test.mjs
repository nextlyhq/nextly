/**
 * POC + contract test for the plugin admin-CSS build.
 *
 * A third-party plugin authors Tailwind against the shared token preset and
 * runs this CLI to produce its `admin.styles`. This proves the output is
 * scoped under `.nextly-admin`, token-referencing (not raw color), and free of
 * a re-emitted preflight reset (which would restyle the host page) — the
 * properties the loading + isolation model depends on.
 */
import { execSync } from "node:child_process";
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
 * TWO limits, because a vitest timeout cannot bound this work on its own.
 * `execSync` blocks the worker's event loop for as long as the child runs, and
 * a timer that cannot be serviced cannot fire — so against a child that HANGS
 * rather than merely running slowly, the case-level budget below expires
 * unnoticed and the suite sits until the workflow's own limit kills it.
 *
 * `CHILD_TIMEOUT_MS` is therefore the real bound: node enforces it on the child
 * and kills it, which unblocks the loop and surfaces a normal assertion
 * failure. The case-level budget is deliberately LARGER, so a hung child is
 * reported as the child failing rather than as vitest giving up on a test whose
 * subprocess is still alive.
 */
const CHILD_TIMEOUT_MS = 60_000;
const COMPILE_TIMEOUT_MS = CHILD_TIMEOUT_MS + 30_000;

describe("nextly-build-admin-css (POC)", () => {
  it(
    "compiles a plugin entry to scoped, token-driven CSS",
    () => {
      const out = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), "nx-poc-")),
        "admin.css"
      );
      execSync(
        `node "${ROOT}/bin/nextly-build-admin-css.mjs" "${ROOT}/__fixtures__/poc-plugin/admin.css" "${out}"`,
        { cwd: ROOT, timeout: CHILD_TIMEOUT_MS }
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
