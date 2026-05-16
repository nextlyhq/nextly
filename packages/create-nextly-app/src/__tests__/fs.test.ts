/**
 * Tests for the empty-directory helpers used by the CLI's
 * "directory not empty" recovery flow.
 */

import os from "os";
import path from "path";

import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emptyDirectory, isDirectoryNotEmpty } from "../utils/fs";

describe("isDirectoryNotEmpty", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cna-fs-"));
  });

  afterEach(async () => {
    await fs.remove(tmp);
  });

  it("returns false for a missing directory", async () => {
    expect(await isDirectoryNotEmpty(path.join(tmp, "missing"))).toBe(false);
  });

  it("returns false for an empty directory", async () => {
    expect(await isDirectoryNotEmpty(tmp)).toBe(false);
  });

  it("returns false when the only entry is `.git`", async () => {
    await fs.ensureDir(path.join(tmp, ".git"));
    expect(await isDirectoryNotEmpty(tmp)).toBe(false);
  });

  it("returns true when a regular file exists", async () => {
    await fs.writeFile(path.join(tmp, "README.md"), "hi");
    expect(await isDirectoryNotEmpty(tmp)).toBe(true);
  });

  it("treats hidden files (other than .git) as non-empty", async () => {
    // .env left over from a previous attempt should still count.
    await fs.writeFile(path.join(tmp, ".env"), "X=1");
    expect(await isDirectoryNotEmpty(tmp)).toBe(true);
  });
});

describe("emptyDirectory", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cna-fs-"));
  });

  afterEach(async () => {
    await fs.remove(tmp);
  });

  it("is a no-op when the directory does not exist", async () => {
    // Should not throw.
    await emptyDirectory(path.join(tmp, "nope"));
  });

  it("removes regular files and subdirectories", async () => {
    await fs.writeFile(path.join(tmp, "README.md"), "hi");
    await fs.ensureDir(path.join(tmp, "src"));
    await fs.writeFile(path.join(tmp, "src/index.ts"), "x");

    await emptyDirectory(tmp);

    expect(await fs.readdir(tmp)).toEqual([]);
  });

  it("preserves `.git` so existing history is not lost", async () => {
    await fs.ensureDir(path.join(tmp, ".git"));
    await fs.writeFile(path.join(tmp, ".git/HEAD"), "ref: refs/heads/main");
    await fs.writeFile(path.join(tmp, "old.txt"), "stale");

    await emptyDirectory(tmp);

    const entries = await fs.readdir(tmp);
    expect(entries).toEqual([".git"]);
    expect(await fs.readFile(path.join(tmp, ".git/HEAD"), "utf-8")).toContain(
      "refs/heads/main"
    );
  });
});
