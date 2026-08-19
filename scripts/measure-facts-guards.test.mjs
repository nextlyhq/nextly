import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The pr-scopes row and the carry-forward are the two measure-facts
 * mechanisms whose failure is silent: a scopes extraction that degrades
 * records a wrong list at exit 0, and a carried heavy row that loses its
 * stamp publishes an old number as a fresh one. Both are exercised here
 * against fixtures, reading the live command out of the script rather than
 * retyping it, so the test cannot drift from the implementation.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The pr-scopes command exactly as the generator will run it. */
function scopesCmd() {
  const src = readFileSync(resolve(repoRoot, "scripts/measure-facts.mjs"), "utf8");
  const m = src.match(/id: "pr-scopes"[\s\S]*?cmd: "((?:[^"\\]|\\.)*)"/);
  expect(m, "pr-scopes cmd not found in measure-facts.mjs").toBeTruthy();
  return JSON.parse(`"${m[1]}"`);
}

function runInFixture(scopesLines) {
  const dir = mkdtempSync(join(tmpdir(), "scopes-fixture-"));
  mkdirSync(join(dir, ".github/workflows"), { recursive: true });
  writeFileSync(
    join(dir, ".github/workflows/pr-title.yml"),
    `          scopes: |\n${scopesLines.map(l => `            ${l}`).join("\n")}\n          requireScope: false\n`,
  );
  return spawnSync("bash", ["-o", "pipefail", "-c", scopesCmd()], { cwd: dir, encoding: "utf8" });
}

describe("the pr-scopes extraction fails closed", () => {
  it("reads a healthy block", () => {
    const r = runInFixture(["nextly", "admin", "eslint-plugin"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("nextly admin eslint-plugin");
  });

  it("refuses a token that is not scope-shaped", () => {
    const r = runInFixture(["nextly", "{{ broken }}", "admin"]);
    expect(r.status).not.toBe(0);
  });

  it("refuses a token with an internal space rather than concatenating it", () => {
    const r = runInFixture(["nextly", "plugin sdk", "admin"]);
    expect(r.status).not.toBe(0);
  });
});

describe("carried heavy rows keep their original stamp", () => {
  it("a cheap run re-emits the committed command line verbatim", () => {
    const committed = readFileSync(resolve(repoRoot, "AGENTS.measured.md"), "utf8");
    const row = committed.match(/## check-types-cold\n[\s\S]*?\n```\n(\$[^\n]*)\n/);
    expect(row, "committed check-types-cold row not found").toBeTruthy();
    const fresh = spawnSync(
      "node",
      ["scripts/measure-facts.mjs", "--only=check-types-cold", "--stdout"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(fresh.status, fresh.stderr).toBe(0);
    // The carried row's command line — its original revision stamp included —
    // must survive the cheap run byte for byte; a fresh stamp here is the
    // falsified-provenance defect this guards against.
    expect(fresh.stdout).toContain(row[1]);
  });
});
