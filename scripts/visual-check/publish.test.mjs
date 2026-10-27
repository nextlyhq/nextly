import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  lookSection,
  MAX_CAPTURE_BYTES,
  oversizedCaptures,
  publishCaptures,
  rawBaseFor,
  unpublishCaptures,
} from "./publish.mjs";

const RAW = "https://raw.githubusercontent.com/nextlyhq/nextly";

describe("the pull request's look section", () => {
  it("links every capture by its raw address, the 390 px ones first", () => {
    const files = [
      "admin-1440-light.png",
      "admin-1440-dark.png",
      "admin-390-light.png",
      "admin-390-dark.png",
    ];
    const markdown = lookSection({ rawBase: RAW, topic: "posts-list", files });
    expect(markdown).toMatch(/^## The look/m);
    const links = [...markdown.matchAll(/\((https:[^)]+)\)/g)].map(
      match => match[1]
    );
    expect(links).toEqual([
      `${RAW}/pr-screenshots/posts-list/admin-390-light.png`,
      `${RAW}/pr-screenshots/posts-list/admin-390-dark.png`,
      `${RAW}/pr-screenshots/posts-list/admin-1440-light.png`,
      `${RAW}/pr-screenshots/posts-list/admin-1440-dark.png`,
    ]);
  });

  it("reads the repository from a GitHub remote, and falls back to nextly's own", () => {
    expect(rawBaseFor("git@github.com:someone/nextly.git")).toBe(
      "https://raw.githubusercontent.com/someone/nextly"
    );
    expect(rawBaseFor("https://github.com/nextlyhq/nextly")).toBe(RAW);
    expect(rawBaseFor("/tmp/bare.git")).toBe(RAW);
  });
});

describe("publishing the captures", () => {
  let dir;
  let author;
  let bare;
  let captures;

  const git = (cwd, ...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "visual-check-publish-"));
    bare = path.join(dir, "remote.git");
    author = path.join(dir, "author");
    captures = path.join(dir, "captures");
    execFileSync("git", ["init", "--bare", "--quiet", bare]);
    execFileSync("git", ["init", "--quiet", "--initial-branch=main", author]);
    for (const [key, value] of [
      ["user.name", "Author"],
      ["user.email", "author@example.com"],
      ["commit.gpgsign", "false"],
    ]) {
      git(author, "config", key, value);
    }
    writeFileSync(path.join(author, "code.mjs"), "export const x = 1;\n");
    git(author, "add", "code.mjs");
    git(author, "commit", "--quiet", "-m", "first");
    git(author, "remote", "add", "origin", bare);
    git(author, "push", "--quiet", "origin", "main");
    // Left uncommitted on purpose: publishing must leave it exactly as it was.
    writeFileSync(path.join(author, "code.mjs"), "export const x = 2;\n");
    execFileSync("mkdir", [captures]);
    for (const name of ["admin-390-light.png", "admin-390-dark.png"]) {
      writeFileSync(path.join(captures, name), `png ${name}`);
    }
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const files = () =>
    ["admin-390-light.png", "admin-390-dark.png"].map(name =>
      path.join(captures, name)
    );

  it("pushes the captures to a branch that shares no history with main", async () => {
    await publishCaptures({ cwd: author, topic: "posts-list", files: files() });
    const branch = "refs/heads/pr-screenshots/posts-list";
    expect(
      git(bare, "ls-tree", "--name-only", branch).split("\n").sort()
    ).toEqual(["admin-390-dark.png", "admin-390-light.png"]);
    expect(git(bare, "show", `${branch}:admin-390-light.png`)).toBe(
      "png admin-390-light.png"
    );
    // No parent, and so nothing in common with main.
    expect(git(bare, "rev-list", "--count", branch)).toBe("1");
    expect(() => git(bare, "merge-base", "main", branch)).toThrow();
  });

  it("leaves the author's checkout, index and branches as they were", async () => {
    const before = {
      head: git(author, "rev-parse", "HEAD"),
      status: git(author, "status", "--porcelain"),
      branches: git(author, "branch", "--list"),
    };
    await publishCaptures({ cwd: author, topic: "posts-list", files: files() });
    expect(git(author, "rev-parse", "HEAD")).toBe(before.head);
    expect(git(author, "status", "--porcelain")).toBe(before.status);
    expect(git(author, "branch", "--list")).toBe(before.branches);
  });

  it("publishes again on top of its own branch, without a forced push", async () => {
    await publishCaptures({ cwd: author, topic: "posts-list", files: files() });
    writeFileSync(path.join(captures, "admin-390-light.png"), "png again");
    await publishCaptures({
      cwd: author,
      topic: "posts-list",
      files: [path.join(captures, "admin-390-light.png")],
    });
    const branch = "refs/heads/pr-screenshots/posts-list";
    expect(git(bare, "ls-tree", "--name-only", branch)).toBe(
      "admin-390-light.png"
    );
    expect(git(bare, "show", `${branch}:admin-390-light.png`)).toBe(
      "png again"
    );
    expect(git(bare, "rev-list", "--count", branch)).toBe("2");
    expect(() => git(bare, "merge-base", "main", branch)).toThrow();
  });

  it("refuses a capture over 1 MB, naming it, and pushes nothing", async () => {
    const big = path.join(captures, "admin-1440-light.png");
    writeFileSync(big, Buffer.alloc(MAX_CAPTURE_BYTES + 1));
    expect(MAX_CAPTURE_BYTES).toBe(1024 * 1024);
    expect(oversizedCaptures([...files(), big])).toEqual([
      { file: big, bytes: MAX_CAPTURE_BYTES + 1 },
    ]);
    await expect(
      publishCaptures({
        cwd: author,
        topic: "posts-list",
        files: [...files(), big],
      })
    ).rejects.toThrow(/admin-1440-light\.png/);
    expect(git(bare, "branch", "--list")).not.toMatch(/pr-screenshots/);
  });

  const BRANCH = "refs/heads/pr-screenshots/posts-list";
  const sourceOf = ref =>
    git(
      bare,
      "log",
      "-1",
      "--format=%(trailers:key=Source-Branch,valueonly)",
      ref
    );

  it("records which branch published the captures", async () => {
    await publishCaptures({ cwd: author, topic: "posts-list", files: files() });
    expect(sourceOf(BRANCH)).toBe("main");
  });

  it("refuses a topic another branch published, naming that branch, and pushes nothing", async () => {
    await publishCaptures({ cwd: author, topic: "posts-list", files: files() });
    const tip = git(bare, "rev-parse", BRANCH);
    git(author, "checkout", "--quiet", "-b", "other-change");
    await expect(
      publishCaptures({ cwd: author, topic: "posts-list", files: files() })
    ).rejects.toThrow(/pr-screenshots\/posts-list.*\bmain\b/);
    expect(git(bare, "rev-parse", BRANCH)).toBe(tip);
  });

  it("refuses a topic whose branch records no publishing branch, and pushes nothing", async () => {
    const tree = git(author, "write-tree");
    const untagged = git(author, "commit-tree", tree, "-m", "made by hand");
    git(author, "push", "--quiet", "origin", `${untagged}:${BRANCH}`);
    await expect(
      publishCaptures({ cwd: author, topic: "posts-list", files: files() })
    ).rejects.toThrow(/records no source branch/);
    expect(git(bare, "rev-parse", BRANCH)).toBe(untagged);
  });

  it("refuses to publish from a detached HEAD, which names no branch to record", async () => {
    git(author, "checkout", "--quiet", "--detach");
    await expect(
      publishCaptures({ cwd: author, topic: "posts-list", files: files() })
    ).rejects.toThrow(/branch/);
    expect(git(bare, "branch", "--list")).not.toMatch(/pr-screenshots/);
  });

  it("deletes a published topic, saying which branch had published it", async () => {
    await publishCaptures({ cwd: author, topic: "posts-list", files: files() });
    expect(
      await unpublishCaptures({ cwd: author, topic: "posts-list" })
    ).toEqual({
      deleted: true,
      source: "main",
    });
    expect(git(bare, "branch", "--list")).not.toMatch(/pr-screenshots/);
    expect(git(bare, "branch", "--list")).toMatch(/main/);
  });

  it("deletes nothing, and says so, for a topic not published", async () => {
    expect(
      await unpublishCaptures({ cwd: author, topic: "posts-list" })
    ).toEqual({
      deleted: false,
    });
    expect(git(bare, "branch", "--list")).toMatch(/main/);
  });
});
