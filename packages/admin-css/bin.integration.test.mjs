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

describe("nextly-build-admin-css (POC)", () => {
  it("compiles a plugin entry to scoped, token-driven CSS", () => {
    const out = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "nx-poc-")),
      "admin.css"
    );
    execSync(
      `node "${ROOT}/bin/nextly-build-admin-css.mjs" "${ROOT}/__fixtures__/poc-plugin/admin.css" "${out}"`,
      { cwd: ROOT }
    );
    const css = fs.readFileSync(out, "utf-8");

    // Scoped: no rule escapes the wrapper.
    expect(findUnscopedRules(css)).toEqual([]);
    // No preflight reset re-emitted (that universal selector would restyle host).
    expect(css).not.toMatch(/\*,\s*::before,\s*::after/);
    // The fixture's utilities are present and token-driven.
    expect(css).toContain(".nextly-admin");
    expect(css).toMatch(/var\(--/);
  });
});
