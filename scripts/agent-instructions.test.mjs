/**
 * What keeps each CLAUDE.md a copy of the instruction file the AGENTS.md harness reads beside
 * it. Each case builds a small repository in a temporary directory, so the
 * property is judged on files, not on mocks.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { copies, copyDrift, header, syncCopies } from "./agent-instructions.mjs";

const SCRIPT = fileURLToPath(new URL("./agent-instructions.mjs", import.meta.url));
const REPO = fileURLToPath(new URL("..", import.meta.url));
let base;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "agent-instructions-"));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function put(path, text) {
  mkdirSync(dirname(join(base, path)), { recursive: true });
  writeFileSync(join(base, path), text);
}

const read = path => readFileSync(join(base, path), "utf8");

describe("the copies Claude Code reads", () => {
  it("puts a CLAUDE.md beside each file Codex takes, copying the override where there is one", () => {
    expect(copies(["AGENTS.md", "a/AGENTS.md", "a/AGENTS.override.md", "b/x.ts"])).toEqual([
      { source: "AGENTS.md", copy: "CLAUDE.md" },
      { source: "a/AGENTS.override.md", copy: "a/CLAUDE.md" },
    ]);
  });

  it("writes each copy as its header and its source whole, replacing an import of the source, and then finds nothing out of step", () => {
    put("AGENTS.md", "root rules\n");
    put("CLAUDE.md", "@AGENTS.md\n");
    put("p/AGENTS.md", "package rules\n");
    const tracked = ["AGENTS.md", "CLAUDE.md", "p/AGENTS.md"];
    syncCopies(base, tracked);
    expect(read("CLAUDE.md")).toBe(`${header("AGENTS.md")}root rules\n`);
    expect(read("p/CLAUDE.md")).toBe(`${header("p/AGENTS.md")}package rules\n`);
    expect(copyDrift(base, [...tracked, "p/CLAUDE.md"])).toEqual([]);
  });

  it("refuses to overwrite a CLAUDE.md holding text of its own, and leaves it as it was", () => {
    put("AGENTS.md", "root rules\n");
    put("CLAUDE.md", "My own notes.\n");
    expect(() => syncCopies(base, ["AGENTS.md", "CLAUDE.md"])).toThrow("CLAUDE.md holds text of its own; move it into AGENTS.md, then sync again");
    expect(read("CLAUDE.md")).toBe("My own notes.\n");
  });

  it("names a copy that differs, one that is missing, and a CLAUDE.md with no instruction file to copy", () => {
    put("AGENTS.md", "root rules\n");
    put("CLAUDE.md", `${header("AGENTS.md")}root rules, edited in the copy\n`);
    put("p/AGENTS.md", "package rules\n");
    put("q/CLAUDE.md", "Orphaned.\n");
    expect(copyDrift(base, ["AGENTS.md", "CLAUDE.md", "p/AGENTS.md", "q/CLAUDE.md"])).toEqual([
      { path: "CLAUDE.md", problem: "differs from AGENTS.md", fix: "run pnpm instructions:sync" },
      { path: "p/CLAUDE.md", problem: "is missing, so Claude Code never reads p/AGENTS.md", fix: "run pnpm instructions:sync" },
      { path: "q/CLAUDE.md", problem: "copies no AGENTS.md beside it, so Codex never reads its text", fix: "move its text into an AGENTS.md there, then run pnpm instructions:sync" },
    ]);
  });
});

describe("this repository", () => {
  it("has every CLAUDE.md a copy of the instruction file beside it", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean);
    expect(copyDrift(REPO, tracked)).toEqual([]);
  });

  it("refuses a command it does not know", () => {
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(run.status).toBe(64);
    expect(run.stderr).toContain("usage: node scripts/agent-instructions.mjs sync");
  });
});
