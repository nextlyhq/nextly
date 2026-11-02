/**
 * Next.js's upgrade reminder stays quiet in CI (`CI` is set) unless a coding
 * agent's environment variable is also set: then it ignores `CI`, and a build
 * that finds an advisory ends with exit 1. So no workflow or local action names
 * one at all. The names are read from the detector Next.js itself bundles, so a
 * name it learns in a later release is checked here without an edit.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The variables a detector's source reads, and how many of its reads of the
 * environment are not a plain `process.env.NAME`. A read spelled any other way
 * (`process.env[name]`, a destructure, an alias) is one this cannot name, so
 * the test refuses the source rather than check an incomplete list.
 */
function readsOf(source) {
  const names = [...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)\b/g)].map(([, name]) => name);
  const reads = source.match(/process\.env\b/g) ?? [];
  return { names: [...new Set(names)], unnamed: reads.length - names.length };
}

/**
 * The names among `names` a file mentions anywhere, as a whole word: an env key,
 * a shell or PowerShell assignment, a string. In any case, since Windows treats
 * `$env:codex_ci` and `CODEX_CI` as one variable.
 */
function mentioned(text, names) {
  return names.filter(name => new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, "i").test(text));
}

const fromPlayground = createRequire(new URL("../apps/playground/package.json", import.meta.url));
const detector = readFileSync(join(dirname(fromPlayground.resolve("next/package.json")), "dist/compiled/@vercel/detect-agent/index.js"), "utf8");
const { names: AGENT_VARIABLES, unnamed } = readsOf(detector);

// Every tracked file in the repository, not only the ones CI is known to run:
// a workflow, an action's implementation, a script, or a command a package
// generates for a CI step could each set one through `GITHUB_ENV`, and no
// list of what CI reaches stays complete. Binary files aside, and this file,
// which names them.
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
  .split("\0")
  .filter(path => path && path !== "scripts/workflows-set-no-agent-env.test.mjs");

describe("the variables that tell Next.js a coding agent is building", () => {
  it("are every one Next.js's own detector reads", () => {
    expect(AGENT_VARIABLES).toEqual(expect.arrayContaining(["CLAUDECODE", "CODEX_CI", "CURSOR_AGENT", "AI_AGENT"]));
    expect(unnamed).toBe(0);
    // A read spelled another way is counted, not missed.
    expect(readsOf('a=process.env.CODEX_CI||process.env["NEW_AGENT"]').unnamed).toBe(1);
    expect(readsOf("const e=process.env;e.NEW_AGENT").unnamed).toBe(1);
  });

  it("are found however a workflow would set them", () => {
    const names = ["CODEX_CI", "CLAUDECODE"];
    expect(mentioned("    env:\n      CODEX_CI: 1", names)).toEqual(["CODEX_CI"]);
    expect(mentioned('run: $env:CODEX_CI = "1"', names)).toEqual(["CODEX_CI"]);
    expect(mentioned('run: $env:codex_ci = "1"', names)).toEqual(["CODEX_CI"]);
    expect(mentioned('run: $Env:ClaudeCode = "1"', names)).toEqual(["CLAUDECODE"]);
    expect(mentioned("run: export CLAUDECODE=1 && next build", names)).toEqual(["CLAUDECODE"]);
    expect(mentioned('run: echo "CLAUDECODE=1" >> "$GITHUB_ENV"', names)).toEqual(["CLAUDECODE"]);
    expect(mentioned("env:\n  MY_CODEX_CI_FLAG: 1", names)).toEqual([]);
  });

  it("are named by no tracked file in the repository", () => {
    for (const area of [".github/workflows/", ".github/actions/", "scripts/", "packages/create-nextly-app/src/"]) {
      expect(files.filter(path => path.startsWith(area)).length, area).toBeGreaterThan(4);
    }
    const named = files.flatMap(path => {
      const bytes = readFileSync(join(ROOT, path));
      if (bytes.includes(0)) return [];
      return mentioned(bytes.toString("utf8"), AGENT_VARIABLES).map(name => `${path} ${name}`);
    });
    expect(named).toEqual([]);
  });
});
