/**
 * What keeps the instructions the AGENTS.md harness loads within what it reads of them. The
 * chains are judged on file lists and sizes; the command on a small
 * repository built in a temporary directory, and on this one.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LIMIT, chains, describe as describeChain, instructionFiles, overBudget } from "./check-instruction-size.mjs";

const SCRIPT = fileURLToPath(new URL("./check-instruction-size.mjs", import.meta.url));

describe("the chain Codex joins", () => {
  it("takes one file per directory, an override over AGENTS.md, the root first", () => {
    const tracked = ["AGENTS.md", "a/AGENTS.md", "a/b/AGENTS.md", "a/b/AGENTS.override.md", "a/b/c/x.ts", "d/README.md"];
    expect([...instructionFiles(tracked)]).toEqual([
      [".", "AGENTS.md"],
      ["a", "a/AGENTS.md"],
      ["a/b", "a/b/AGENTS.override.md"],
    ]);
    const sizes = { "AGENTS.md": 3, "a/AGENTS.md": 5, "a/b/AGENTS.override.md": 7 };
    expect(chains(tracked, path => sizes[path]).map(chain => [chain.dir, chain.files.map(file => file.path), chain.bytes])).toEqual([
      [".", ["AGENTS.md"], 3],
      ["a", ["AGENTS.md", "a/AGENTS.md"], 8],
      ["a/b", ["AGENTS.md", "a/AGENTS.md", "a/b/AGENTS.override.md"], 15],
    ]);
  });

  it("keeps the override whichever order the files are listed in", () => {
    expect(instructionFiles(["a/AGENTS.override.md", "a/AGENTS.md"]).get("a")).toBe("a/AGENTS.override.md");
  });

  /*
   * The case a check of pairs would pass: any two of the three files fit, and
   * the three are what the AGENTS.md harness joins in `a/b`.
   */
  it("fails a three-file chain where every pair fits and the three do not, naming the files and the bytes over", () => {
    const each = 12_000;
    expect(2 * each).toBeLessThanOrEqual(LIMIT);
    const over = overBudget(chains(["AGENTS.md", "a/AGENTS.md", "a/b/AGENTS.md"], () => each));
    expect(over.map(chain => chain.dir)).toEqual(["a/b"]);
    expect(describeChain(over[0])).toBe("a/b: AGENTS.md (12,000) + a/AGENTS.md (12,000) + a/b/AGENTS.md (12,000) = 36,000 bytes, 3,232 over the 32,768 Codex reads");
  });

  it("passes a chain of exactly 32 KiB, and fails one a byte past it", () => {
    const tracked = ["AGENTS.md", "a/AGENTS.md"];
    const sized = last => path => (path === "AGENTS.md" ? 20_000 : last);
    expect(overBudget(chains(tracked, sized(LIMIT - 20_000)))).toEqual([]);
    expect(overBudget(chains(tracked, sized(LIMIT - 20_000 + 1))).map(chain => chain.dir)).toEqual(["a"]);
  });
});

describe("the command", () => {
  let base;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "instruction-size-"));
    execFileSync("git", ["init", "-q"], { cwd: base });
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  function put(path, bytes) {
    mkdirSync(dirname(join(base, path)), { recursive: true });
    writeFileSync(join(base, path), "x".repeat(bytes));
  }

  function run() {
    execFileSync("git", ["add", "-A"], { cwd: base });
    return spawnSync(process.execPath, [SCRIPT, "--root", base], { encoding: "utf8" });
  }

  it("exits 1 naming each chain past what Codex reads, and 0 once it fits", () => {
    put("AGENTS.md", 30_000);
    put("packages/p/AGENTS.md", 5_000);
    const over = run();
    expect(over.status).toBe(1);
    expect(over.stderr).toContain("packages/p: AGENTS.md (30,000) + packages/p/AGENTS.md (5,000) = 35,000 bytes, 2,232 over the 32,768 Codex reads");

    put("AGENTS.md", 20_000);
    const fits = run();
    expect(fits.status, fits.stderr).toBe(0);
    expect(fits.stdout).toContain("the largest packages/p at 25,000 of 32,768 bytes");
  });

  it("keeps every chain in this repository within what Codex reads", () => {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });
});
