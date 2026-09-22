/**
 * What a unit test of `parseSlot` cannot say about `worktree env`.
 *
 * 🔴 `worktree.test.mjs` calls `parseSlot` directly, so reverting the command
 * to `slotEnv(Number(raw))` leaves the whole suite green while
 * `pnpm worktree env --slot abc` again exits 0 and prints `PORT=NaN`. The
 * helper is not the contract; the command's exit status and stdout are, and a
 * caller sources that stdout.
 *
 * The precedent is `pnpm-invocation.cli.test.mjs` and
 * `verify-merge.cli.test.mjs`, which exist for the same reason: a suite can be
 * entirely green while the command it covers is broken before reaching any of
 * it.
 *
 * @module worktree.cli.test
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MAX_SLOTS } from "./worktree.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "worktree.mjs");

/**
 * Run `worktree` and collect what it did, rather than what it threw.
 *
 * @param {string[]} args - arguments after the script name.
 * @returns {{code: number, stdout: string, stderr: string}} the result.
 */
function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      code: error.status ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

describe("worktree env, as a caller actually runs it", () => {
  it("prints the documented defaults when no slot is named", () => {
    const { code, stdout } = run(["env"]);
    expect(code).toBe(0);
    expect(stdout).toContain("export PORT=3000");
    expect(stdout).toContain("export NEXTLY_TEST_DB=nextly_test");
  });

  it("prints a slot's own block", () => {
    const { code, stdout } = run(["env", "--slot", "3"]);
    expect(code).toBe(0);
    expect(stdout).toContain("export NEXTLY_WORKTREE_SLOT=3");
    expect(stdout).toContain("export NEXTLY_TEST_DB=nextly_test_w3");
  });

  it.each(["abc", "-1", "1.5", "1e3", String(MAX_SLOTS)])(
    "refuses --slot %s without printing anything to source",
    value => {
      const { code, stdout, stderr } = run(["env", "--slot", value]);
      expect(code).toBe(2);
      // Nothing sourceable, so a caller cannot half-apply a broken block.
      expect(stdout).toBe("");
      expect(stderr).toContain("--slot needs an integer");
    }
  );

  it("refuses a --slot with no value rather than meaning the primary checkout", () => {
    const { code, stdout } = run(["env", "--slot"]);
    expect(code).toBe(2);
    expect(stdout).toBe("");
  });

  it("never emits NaN, which is what sourcing a bad slot used to produce", () => {
    for (const value of ["abc", "-1", ""]) {
      expect(run(["env", "--slot", value]).stdout).not.toContain("NaN");
    }
  });
});
