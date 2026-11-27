import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  changesetPackages,
  snapshotChangesetProblem,
} from "./check-tool-snapshot-changeset.mjs";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "check-tool-snapshot-changeset.mjs");
const SNAPSHOT = "packages/mcp/src/__snapshots__/chat.json";
const COVERING = '---\n"nextly": patch\n"@nextlyhq/mcp": patch\n---\n\nRenamed a tool.\n';
const OTHER = '---\n"nextly": patch\n---\n\nSomething else.\n';

describe("which changes need a changeset", () => {
  it("needs none when no snapshot changed", () => {
    expect(snapshotChangesetProblem([{ status: "M", paths: ["packages/mcp/src/names.ts"] }], () => "")).toBeUndefined();
  });

  it.each(["A", "M", "D"])("refuses a snapshot change (%s) with no changeset, naming the file", status => {
    expect(snapshotChangesetProblem([{ status, paths: [SNAPSHOT] }], () => "")).toContain(SNAPSHOT);
  });

  it("refuses a snapshot renamed away with no changeset", () => {
    const problem = snapshotChangesetProblem(
      [{ status: "R", paths: [SNAPSHOT, "packages/mcp/src/old.json"] }],
      () => ""
    );
    expect(problem).toContain(SNAPSHOT);
  });

  it("accepts a snapshot change with a changeset listing the package", () => {
    const changes = [
      { status: "M", paths: [SNAPSHOT] },
      { status: "A", paths: [".changeset/rename.md"] },
    ];
    expect(snapshotChangesetProblem(changes, () => COVERING)).toBeUndefined();
  });

  it("refuses a changeset that doesn't list the package, a deleted one, and the README", () => {
    expect(
      snapshotChangesetProblem(
        [{ status: "M", paths: [SNAPSHOT] }, { status: "A", paths: [".changeset/other.md"] }],
        () => OTHER
      )
    ).toBeDefined();
    expect(
      snapshotChangesetProblem(
        [{ status: "M", paths: [SNAPSHOT] }, { status: "D", paths: [".changeset/gone.md"] }],
        () => COVERING
      )
    ).toBeDefined();
    expect(
      snapshotChangesetProblem(
        [{ status: "M", paths: [SNAPSHOT] }, { status: "M", paths: [".changeset/README.md"] }],
        () => COVERING
      )
    ).toBeDefined();
  });

  it("reads the package names from the frontmatter only", () => {
    expect(changesetPackages(COVERING)).toEqual(["nextly", "@nextlyhq/mcp"]);
    expect(changesetPackages("No frontmatter. \"@nextlyhq/mcp\": patch")).toEqual([]);
  });
});

describe("the check run on a repository", () => {
  const made = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A repository with a snapshot on `base`, and `files` changed on the branch. */
  function repository(files) {
    const dir = mkdtempSync(join(tmpdir(), "snapshot-changeset-"));
    made.push(dir);
    const git = (...args) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], {
        cwd: dir,
        encoding: "utf8",
      });
    const write = (path, text) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    git("init", "-q", "-b", "base");
    write(SNAPSHOT, '{"tools":[]}\n');
    git("add", "-A");
    git("commit", "-q", "--no-verify", "-m", "base");
    git("checkout", "-q", "-b", "change");
    for (const [path, text] of Object.entries(files)) write(path, text);
    git("add", "-A");
    git("commit", "-q", "--no-verify", "-m", "change");
    return dir;
  }

  function run(dir) {
    try {
      return { code: 0, out: execFileSync("node", [SCRIPT, "base", "change"], { cwd: dir, encoding: "utf8" }) };
    } catch (error) {
      return { code: error.status, out: String(error.stdout) };
    }
  }

  it("fails on a changed snapshot without a changeset", () => {
    const result = run(repository({ [SNAPSHOT]: '{"tools":["get_entry"]}\n' }));
    expect(result.code).toBe(1);
    expect(result.out).toContain("::error title=Tool-list snapshot::");
  });

  it("passes the same change with a changeset that lists the package", () => {
    const result = run(
      repository({ [SNAPSHOT]: '{"tools":["get_entry"]}\n', ".changeset/tool.md": COVERING })
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain("2 changed file(s) read");
  });
});
