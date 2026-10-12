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

import { format, resolveConfig } from "prettier";
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

/** What a refusal adds for a copy that holds nothing of its own, whose recorded digest a formatter update can leave behind. */
const OWN_TEXT_REMEDY = "; if it holds nothing of its own, which a new version of the formatter can make it look to, delete it and sync again";

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

  /*
   * The formatter runs on every commit and rewrites a copy as it rewrites its
   * source, so a copy it rewrote after the sync, and whose source has changed
   * since, is still one nobody edited. The text is run through the formatter
   * itself, with this repository's settings, so the test follows what it
   * actually rewrites: markers, emphasis, escapes, tables and breaks.
   */
  it("takes a copy the formatter rewrote as unedited, once its source has moved on", async () => {
    const written = [
      "* a bullet with *emphasis* and __strong__ text",
      "+ another, naming TEST_* and snake_case and `--no-verify`",
      "",
      "| a | b |",
      "|---|:-:|",
      "| longer cell | x |",
      "",
      "c | d",
      "--|--",
      "1 | 2",
      "",
      "***",
      "",
      "A literal * star and an escaped \\_ underscore.",
      "",
      ">quoted, with no space after its marker",
      "",
    ].join("\n");
    const formatted = await format(written, { ...(await resolveConfig(join(REPO, "AGENTS.md"))), parser: "markdown" });
    expect(formatted).not.toBe(written);
    put("AGENTS.md", "rules written since\n");
    put("CLAUDE.md", `${header("AGENTS.md", written)}${formatted}`);
    syncCopies(base, ["AGENTS.md", "CLAUDE.md"]);
    expect(read("CLAUDE.md")).toBe(copyOf("AGENTS.md", "rules written since\n"));
  });

  it("refuses a copy edited only in its punctuation, which the formatter never rewrites", () => {
    const body = "Never bypass hooks with `--no-verify`, and send `no-store`.\n";
    put("AGENTS.md", "rules written since\n");
    put("CLAUDE.md", `${header("AGENTS.md", body)}${body.replace("--no-verify", "noverify")}`);
    expect(() => syncCopies(base, ["AGENTS.md", "CLAUDE.md"])).toThrow("CLAUDE.md holds text of its own");
    put("CLAUDE.md", `${header("AGENTS.md", body)}${body.replace("no-store", "nostore")}`);
    expect(() => syncCopies(base, ["AGENTS.md", "CLAUDE.md"])).toThrow("CLAUDE.md holds text of its own");
    expect(read("CLAUDE.md")).toContain("nostore");
  });

  // The formatter keeps an escaped star apart from emphasis, so an edit from one to the other is an edit.
  it("refuses a copy whose escaped stars were edited into emphasis", () => {
    const body = "Match the \\*literal\\* name, not a pattern.\n";
    put("AGENTS.md", "rules written since\n");
    put("CLAUDE.md", `${header("AGENTS.md", body)}${body.replaceAll("\\*", "*")}`);
    expect(() => syncCopies(base, ["AGENTS.md", "CLAUDE.md"])).toThrow("CLAUDE.md holds text of its own");
    expect(read("CLAUDE.md")).toContain("*literal*");
  });

  // A digest recorded under another formatter's spelling cannot be told from an edit, so the copy is refused, with the way out named.
  it("refuses a copy whose digest another formatting recorded, naming what to do when it holds nothing of its own", () => {
    put("AGENTS.md", "rules written since\n");
    put("CLAUDE.md", "<!-- Generated from AGENTS.md by `pnpm instructions:sync` (0123456789abcdef). Edit that file, never this one. -->\n\nolder rules\n");
    expect(() => syncCopies(base, ["AGENTS.md", "CLAUDE.md"])).toThrow(`CLAUDE.md holds text of its own; move it into AGENTS.md, then sync again${OWN_TEXT_REMEDY}`);
    expect(read("CLAUDE.md")).toContain("older rules");
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

  it("names a copy only out of date, one holding text of its own, one missing, and a CLAUDE.md with no instruction file to copy", () => {
    put("AGENTS.md", "root rules\n");
    put("CLAUDE.md", `${header("AGENTS.md", "root rules\n")}root rules, edited in the copy\n`);
    put("p/AGENTS.md", "package rules, changed since\n");
    put("p/CLAUDE.md", copyOf("p/AGENTS.md", "package rules\n"));
    put("m/AGENTS.md", "m rules\n");
    put("q/CLAUDE.md", "Orphaned.\n");
    expect(copyDrift(base, ["AGENTS.md", "CLAUDE.md", "p/AGENTS.md", "p/CLAUDE.md", "m/AGENTS.md", "q/CLAUDE.md"])).toEqual([
      { path: "CLAUDE.md", problem: "holds text of its own that AGENTS.md does not", fix: `move that text into AGENTS.md, then run pnpm instructions:sync${OWN_TEXT_REMEDY}` },
      { path: "p/CLAUDE.md", problem: "differs from p/AGENTS.md", fix: "run pnpm instructions:sync" },
      { path: "m/CLAUDE.md", problem: "is missing, so Claude Code never reads m/AGENTS.md", fix: "run pnpm instructions:sync" },
      { path: "q/CLAUDE.md", problem: "copies no AGENTS.md beside it, so the AGENTS.md harness never reads its text", fix: "move its text into an AGENTS.md there, then run pnpm instructions:sync" },
    ]);
  });

  /*
   * The drift check and the sync must agree on which copies were edited: a
   * finding that names the sync as its fix, for a copy the sync then refuses,
   * sends the reader round in a circle.
   */
  it("names the sync as the fix for exactly the copies the sync then rewrites", () => {
    put("AGENTS.md", "root rules, changed since\n");
    const files = ["AGENTS.md", "CLAUDE.md"];
    put("CLAUDE.md", copyOf("AGENTS.md", "root rules\n"));
    expect(copyDrift(base, files).map(finding => finding.fix)).toEqual(["run pnpm instructions:sync"]);
    syncCopies(base, files);
    expect(copyDrift(base, files)).toEqual([]);

    put("CLAUDE.md", `${copyOf("AGENTS.md", "root rules, changed since\n")}A line of its own.\n`);
    expect(copyDrift(base, files).map(finding => finding.fix)).toEqual([`move that text into AGENTS.md, then run pnpm instructions:sync${OWN_TEXT_REMEDY}`]);
    expect(() => syncCopies(base, files)).toThrow("CLAUDE.md holds text of its own");
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
