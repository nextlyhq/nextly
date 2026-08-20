/**
 * The entry guard, and which of its cases each platform can actually witness.
 *
 * The guard decides whether a module runs its CLI block. When it answers
 * wrongly the module stays silent and the process exits 0, so the failure wears
 * the same shape as success and no assertion on a status can separate them.
 * These cases pin the two ways the previous comparison — an interpolated
 * `file://${process.argv[1]}` — was wrong, and say plainly which of them a
 * given machine is able to check.
 *
 * @module cli-entry.test
 */
import { realpathSync } from "node:fs";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { isCliEntry } from "./cli-entry.mjs";

const made = [];

afterEach(async () => {
  process.argv[1] = ARGV1;
  for (const dir of made.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** vitest's own entry, restored after each case rewrites `argv[1]`. */
const ARGV1 = process.argv[1];

async function workspace() {
  const dir = await mkdtemp(path.join(tmpdir(), "cli-entry-"));
  made.push(dir);
  // Canonical, because the resolved-link case builds its expected URL out of
  // these paths while the guard answers with `realpathSync`'s form. A temp
  // root reached through a link — macOS resolves `/var` to `/private/var` —
  // otherwise fails that case against a guard that is behaving correctly.
  return realpathSync(dir);
}

/**
 * Whether this machine can create symlinks at all.
 *
 * Probed rather than inferred from the platform: it is a privilege on Windows
 * (Developer Mode or an elevated shell) rather than a property of the OS, so
 * `process.platform` would both over- and under-report it.
 */
async function canSymlink() {
  try {
    const dir = await workspace();
    const target = path.join(dir, "target.mjs");
    await writeFile(target, "export default 1;");
    await symlink(target, path.join(dir, "link.mjs"));
    return true;
  } catch {
    return false;
  }
}

const SYMLINKS = await canSymlink();

describe("isCliEntry", () => {
  it("matches the module node was asked to run", async () => {
    const entry = path.join(await workspace(), "run-me.mjs");
    process.argv[1] = entry;

    expect(isCliEntry(pathToFileURL(entry).href)).toBe(true);
  });

  it("matches a path that has to be percent-encoded", async () => {
    // The encoding half of the defect, and the half every platform can
    // witness: a space is legal in a path and illegal in a URL, so only URL
    // construction produces the form `import.meta.url` carries. Interpolating
    // the raw path yields `file:///…/needs encoding/run-me.mjs`, which matches
    // nothing. The Windows half — a drive path interpolating to
    // `file://C:\…` against `file:///C:/…` — cannot be reproduced off Windows,
    // so this case is what keeps the defect covered on a Linux runner.
    const dir = await mkdtemp(path.join(tmpdir(), "cli entry needs encoding "));
    made.push(dir);
    const entry = path.join(dir, "run me.mjs");
    process.argv[1] = entry;

    const href = pathToFileURL(entry).href;
    expect(href, "the URL form encodes the spaces").toContain("%20");
    expect(href, "which the interpolated form does not").not.toBe(
      `file://${entry}`
    );
    expect(isCliEntry(href)).toBe(true);
  });

  it("does not match a different module", async () => {
    const dir = await workspace();
    process.argv[1] = path.join(dir, "run-me.mjs");

    expect(isCliEntry(pathToFileURL(path.join(dir, "other.mjs")).href)).toBe(
      false
    );
  });

  it("does not match when there is no entry at all", () => {
    // `node --eval` and some embedders leave `argv[1]` undefined. Reading it
    // without this returns `file:///undefined`-shaped nonsense rather than an
    // answer.
    process.argv[1] = undefined;

    expect(isCliEntry(import.meta.url)).toBe(false);
  });

  // Both symlink cases below need a link to exist, and creating one is a
  // privilege rather than a given. They are the only cases covering the
  // resolution half of the guard, so where they cannot run this file's green
  // says nothing about it — which is why they are skipped visibly rather than
  // quietly folded into a platform check.
  describe.skipIf(!SYMLINKS)("through a symlink", () => {
    it("matches when the runtime resolved the link away", async () => {
      // The default mode: `import.meta.url` is resolved while `argv[1]` keeps
      // the link, so comparing only the raw form never matches.
      const dir = await workspace();
      const target = path.join(dir, "target.mjs");
      await writeFile(target, "export default 1;");
      const link = path.join(dir, "link.mjs");
      await symlink(target, link);
      process.argv[1] = link;

      expect(isCliEntry(pathToFileURL(target).href)).toBe(true);
    });

    it("matches when the runtime kept the link", async () => {
      // `--preserve-symlinks-main` inverts it, and `NODE_OPTIONS` can set that
      // from outside the command line — so the resolved form is the one that
      // misses, and neither form alone is safe to depend on.
      const dir = await workspace();
      const target = path.join(dir, "target.mjs");
      await writeFile(target, "export default 1;");
      const link = path.join(dir, "link.mjs");
      await symlink(target, link);
      process.argv[1] = link;

      expect(isCliEntry(pathToFileURL(link).href)).toBe(true);
    });
  });
});
