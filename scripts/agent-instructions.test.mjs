/**
 * What keeps each CLAUDE.md a copy of the instruction file the AGENTS.md
 * harness reads beside it. Each case builds a small repository in a temporary
 * directory, so the property is judged on files, not on mocks.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { copies, copyDrift, header, syncCopies } from "./agent-instructions.mjs";

const POSIX = process.platform !== "win32";
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
const copyOf = (source, body) => `${header(source, body)}${body}`;

describe("the copies Claude Code reads", () => {
  it("puts a CLAUDE.md beside each file the AGENTS.md harness takes, copying the override where there is one", () => {
    expect(copies(["AGENTS.md", "a/AGENTS.md", "a/AGENTS.override.md", "b/x.ts"])).toEqual([
      { source: "AGENTS.md", copy: "CLAUDE.md" },
      { source: "a/AGENTS.override.md", copy: "a/CLAUDE.md" },
    ]);
  });

  it("writes each copy as its header and its source whole, replacing an import of the source, and then finds nothing out of step", () => {
    put("AGENTS.md", "root rules\n");
    put("CLAUDE.md", "@AGENTS.md\n");
    put("p/AGENTS.md", "package rules\n");
    const files = ["AGENTS.md", "CLAUDE.md", "p/AGENTS.md"];
    syncCopies(base, files);
    expect(read("CLAUDE.md")).toBe(copyOf("AGENTS.md", "root rules\n"));
    expect(read("p/CLAUDE.md")).toBe(copyOf("p/AGENTS.md", "package rules\n"));
    expect(copyDrift(base, [...files, "p/CLAUDE.md"])).toEqual([]);
  });

  /*
   * A copy is rewritten only while nobody has edited it: its text still matches
   * the digest its header recorded, whatever the source says now, or already
   * matches the source. Text added below a copied header matches neither.
   */
  it("rewrites a copy that is only out of date, and refuses one with text added below its header", () => {
    put("AGENTS.md", "new rules\n");
    put("CLAUDE.md", copyOf("AGENTS.md", "old rules\n"));
    syncCopies(base, ["AGENTS.md", "CLAUDE.md"]);
    expect(read("CLAUDE.md")).toBe(copyOf("AGENTS.md", "new rules\n"));

    put("CLAUDE.md", `${copyOf("AGENTS.md", "new rules\n")}My own line.\n`);
    put("AGENTS.md", "newer rules\n");
    expect(() => syncCopies(base, ["AGENTS.md", "CLAUDE.md"])).toThrow("CLAUDE.md holds text of its own; move it into AGENTS.md, then sync again");
    expect(read("CLAUDE.md")).toContain("My own line.");
  });

  it("takes a copy that already matches its source as unedited, whatever its header recorded", () => {
    put("AGENTS.md", "root rules\n");
    put("CLAUDE.md", `${header("AGENTS.md", "an older text\n")}root rules\n`);
    syncCopies(base, ["AGENTS.md", "CLAUDE.md"]);
    expect(read("CLAUDE.md")).toBe(copyOf("AGENTS.md", "root rules\n"));
  });

  it("takes a copy the formatter re-padded along with its source as unedited", () => {
    put("AGENTS.md", "| a | b |\n| --- | --- |\n");
    put("CLAUDE.md", `${header("AGENTS.md", "| a | b |\n|---|---|\n")}| a   | b   |\n| --- | --- |\n`);
    syncCopies(base, ["AGENTS.md", "CLAUDE.md"]);
    expect(read("CLAUDE.md")).toBe(copyOf("AGENTS.md", "| a | b |\n| --- | --- |\n"));
  });

  it("refuses to overwrite a CLAUDE.md holding text of its own, and leaves it as it was", () => {
    put("AGENTS.md", "root rules\n");
    put("CLAUDE.md", "My own notes.\n");
    expect(() => syncCopies(base, ["AGENTS.md", "CLAUDE.md"])).toThrow("CLAUDE.md holds text of its own; move it into AGENTS.md, then sync again");
    expect(read("CLAUDE.md")).toBe("My own notes.\n");
  });

  it("checks every copy before writing any, so one refusal changes none of them", () => {
    put("AGENTS.md", "root rules\n");
    put("q/AGENTS.md", "q rules\n");
    put("q/CLAUDE.md", "Notes of its own.\n");
    expect(() => syncCopies(base, ["AGENTS.md", "q/AGENTS.md", "q/CLAUDE.md"])).toThrow("q/CLAUDE.md holds text of its own");
    expect(existsSync(join(base, "CLAUDE.md"))).toBe(false);
  });

  /*
   * A write follows a symbolic link to whatever it points at, which for a copy
   * pointing at another copy would replace that file with the wrong text.
   */
  it.runIf(POSIX)("refuses a copy that is a symbolic link, leaving the file it points at as it was", () => {
    put("AGENTS.md", "root rules\n");
    put("CLAUDE.md", copyOf("AGENTS.md", "root rules\n"));
    put("p/AGENTS.md", "package rules\n");
    symlinkSync(join(base, "CLAUDE.md"), join(base, "p/CLAUDE.md"));
    expect(() => syncCopies(base, ["AGENTS.md", "CLAUDE.md", "p/AGENTS.md", "p/CLAUDE.md"])).toThrow("p/CLAUDE.md is a symbolic link");
    expect(read("CLAUDE.md")).toBe(copyOf("AGENTS.md", "root rules\n"));
    expect(copyDrift(base, ["AGENTS.md", "CLAUDE.md", "p/AGENTS.md", "p/CLAUDE.md"])).toEqual([
      { path: "p/CLAUDE.md", problem: "is a symbolic link — it must be a real copy", fix: "replace it with a real file, then run pnpm instructions:sync" },
    ]);
  });

  it("copies an AGENTS.md git does not track yet, and skips one git ignores or one deleted from the tree", () => {
    execFileSync("git", ["init", "-q"], { cwd: base });
    put(".gitignore", "ignored/\n");
    put("AGENTS.md", "root rules\n");
    put("fresh/AGENTS.md", "not staged yet\n");
    put("ignored/AGENTS.md", "ignored\n");
    // Tracked, then deleted from the working tree without staging that.
    put("gone/AGENTS.md", "deleted\n");
    execFileSync("git", ["add", "gone/AGENTS.md"], { cwd: base });
    rmSync(join(base, "gone/AGENTS.md"));
    syncCopies(base);
    expect(read("fresh/CLAUDE.md")).toBe(copyOf("fresh/AGENTS.md", "not staged yet\n"));
    expect(existsSync(join(base, "ignored/CLAUDE.md"))).toBe(false);
    expect(existsSync(join(base, "gone/CLAUDE.md"))).toBe(false);
  });

  it("names a copy that differs, one that is missing, and a CLAUDE.md with no instruction file to copy", () => {
    put("AGENTS.md", "root rules\n");
    put("CLAUDE.md", `${header("AGENTS.md", "root rules\n")}root rules, edited in the copy\n`);
    put("p/AGENTS.md", "package rules\n");
    put("q/CLAUDE.md", "Orphaned.\n");
    expect(copyDrift(base, ["AGENTS.md", "CLAUDE.md", "p/AGENTS.md", "q/CLAUDE.md"])).toEqual([
      { path: "CLAUDE.md", problem: "differs from AGENTS.md", fix: "run pnpm instructions:sync" },
      { path: "p/CLAUDE.md", problem: "is missing, so Claude Code never reads p/AGENTS.md", fix: "run pnpm instructions:sync" },
      { path: "q/CLAUDE.md", problem: "copies no AGENTS.md beside it, so the AGENTS.md harness never reads its text", fix: "move its text into an AGENTS.md there, then run pnpm instructions:sync" },
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
