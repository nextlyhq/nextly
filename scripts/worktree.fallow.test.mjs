/**
 * What `worktree remove` and `worktree sweep` do with the base snapshots
 * fallow's audit keeps, checked against snapshots the pinned fallow makes.
 *
 * A fixture written by hand would say what a snapshot looked like when the
 * test was written. These come from running `fallow audit` in scratch
 * checkouts with `TMPDIR` pointed at a scratch directory, so a fallow upgrade
 * that moves or renames its owner record fails here, rather than leaving the
 * snapshots to pile up again unnoticed.
 *
 * The commands run as a copy of `worktree.mjs` inside a scratch repository,
 * because the script acts on the repository it sits in. The scratch checkouts
 * hold no slot claim, so removal treats them as slot 0, whose databases are
 * never dropped: no test database is touched, whatever containers are running.
 *
 * @module worktree.fallow.test
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { fallowSnapshots, removeSnapshot, snapshotsOwnedBy } from "./worktree.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FALLOW = join(HERE, "..", "node_modules", "fallow", "bin", "fallow");

// Git and fallow here read none of the developer's settings: GIT_DIR inside a
// hook would point git at another repository, their configuration could sign
// or hook these commits, and FALLOW_AUDIT_BASE would override the base named
// below. Telemetry is opt-in; DO_NOT_TRACK makes sure.
const isolatedEnv = temp => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && !name.startsWith("FALLOW_"))
  ),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  DO_NOT_TRACK: "1",
  TMPDIR: temp,
});

const scratchDirs = [];
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A repository holding a copy of the script, and an empty temporary
 * directory standing in for the machine's.
 */
function scratch() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "worktree-fallow-")));
  scratchDirs.push(dir);
  const world = { dir, repo: join(dir, "repo"), temp: join(dir, "tmp") };
  mkdirSync(join(world.repo, "src"), { recursive: true });
  mkdirSync(join(world.repo, "scripts"));
  mkdirSync(world.temp);
  copyFileSync(join(HERE, "worktree.mjs"), join(world.repo, "scripts", "worktree.mjs"));
  writeFileSync(join(world.repo, "package.json"), '{"name":"scratch","type":"module","main":"src/index.js"}\n');
  writeFileSync(join(world.repo, "src", "index.js"), "export const a = 1;\n");
  writeFileSync(join(world.repo, ".gitignore"), "node_modules\n");
  git(world, world.repo, "init", "-q", "-b", "main");
  git(world, world.repo, "add", "package.json", "src", ".gitignore");
  git(world, world.repo, "commit", "-q", "-m", "base");
  return world;
}

function git(world, cwd, ...args) {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd,
    encoding: "utf8",
    env: isolatedEnv(world.temp),
  }).trim();
}

/**
 * A checkout on its own branch with one change, audited by fallow so that it
 * owns a base snapshot. Its `node_modules` carries pnpm's marker, which is
 * what makes fallow link it into the snapshot.
 */
function auditedCheckout(world, branch) {
  const path = join(world.dir, branch);
  git(world, world.repo, "worktree", "add", "-q", "-b", branch, path, "main");
  writeFileSync(join(path, "src", "index.js"), `export const a = 1;\nexport const ${branch} = 2;\n`);
  git(world, path, "commit", "-q", "-am", branch);
  mkdirSync(join(path, "node_modules"));
  writeFileSync(join(path, "node_modules", ".modules.yaml"), "layoutVersion: 5\n");
  writeFileSync(join(path, "node_modules", "keep-me"), "a live checkout's dependency\n");
  try {
    execFileSync(process.execPath, [FALLOW, "audit", "--base", "main", "--format", "json", "--quiet"], {
      cwd: path,
      env: isolatedEnv(world.temp),
      stdio: "ignore",
    });
  } catch (error) {
    // A fail verdict exits 1 and still leaves the snapshot, which is all this
    // needs. Anything else is fallow not running at all.
    if (error.status !== 1) throw error;
  }
  const [snapshot] = snapshotsOwnedBy(fallowSnapshots(world.temp), path);
  // The positive control: without it, every assertion that a snapshot is
  // gone would pass on a fallow that never made one.
  expect(snapshot, `fallow made no snapshot for ${path}`).toBeDefined();
  expect(lstatSync(snapshot.path).isDirectory()).toBe(true);
  return { path, branch, snapshot: snapshot.path };
}

/** Run the scratch copy of the script and collect what it did, rather than what it threw. */
function worktreeCommand(world, ...args) {
  const run = spawnSync(process.execPath, [join(world.repo, "scripts", "worktree.mjs"), ...args], {
    cwd: world.repo,
    encoding: "utf8",
    env: isolatedEnv(world.temp),
  });
  return { code: run.status, stdout: `${run.stdout}${run.stderr}` };
}

/** Whether anything of a snapshot remains apart from its lock, which fallow never removes. */
function snapshotRemains(snapshot) {
  return [snapshot, `${snapshot}.sha`, `${snapshot}.last-used`].some(path => existsSync(path));
}

describe.runIf(process.platform !== "win32")("fallow base snapshots and the checkouts that own them", () => {
  it("reads the owner fallow records for the snapshot it made", () => {
    const world = scratch();
    const checkout = auditedCheckout(world, "one");

    expect(fallowSnapshots(world.temp)).toEqual([{ path: checkout.snapshot, owner: checkout.path }]);
  }, 60_000);

  it("removes the removed checkout's snapshot, and no other", () => {
    const world = scratch();
    const gone = auditedCheckout(world, "gone");
    const kept = auditedCheckout(world, "kept");

    const { code, stdout } = worktreeCommand(world, "remove", "gone");

    expect(code, stdout).toBe(0);
    expect(existsSync(gone.path)).toBe(false);
    expect(snapshotRemains(gone.snapshot)).toBe(false);
    expect(stdout).toContain(`fallow base snapshot removed: ${gone.snapshot}`);
    // fallow's lock stays, as fallow leaves it.
    expect(existsSync(`${gone.snapshot}.lock`)).toBe(true);
    expect(fallowSnapshots(world.temp)).toEqual([{ path: kept.snapshot, owner: kept.path }]);
  }, 60_000);

  it("leaves the snapshot alone when git refuses to remove its checkout", () => {
    const world = scratch();
    const dirty = auditedCheckout(world, "dirty");
    writeFileSync(join(dirty.path, "src", "unsaved.js"), "export const work = 1;\n");

    const { code } = worktreeCommand(world, "remove", "dirty");

    expect(code).toBe(1);
    expect(existsSync(dirty.path)).toBe(true);
    expect(fallowSnapshots(world.temp)).toEqual([{ path: dirty.snapshot, owner: dirty.path }]);
  }, 60_000);

  it("sweeps a snapshot whose checkout went some other way, and keeps a live one's", () => {
    const world = scratch();
    const gone = auditedCheckout(world, "gone");
    const kept = auditedCheckout(world, "kept");
    git(world, world.repo, "worktree", "remove", "--force", gone.path);
    // Removed behind the script's back, the checkout leaves its snapshot.
    expect(snapshotRemains(gone.snapshot)).toBe(true);

    const { code, stdout } = worktreeCommand(world, "sweep");

    expect(code, stdout).toBe(0);
    expect(snapshotRemains(gone.snapshot)).toBe(false);
    expect(stdout).toContain(`fallow base snapshot removed: ${gone.snapshot}`);
    expect(fallowSnapshots(world.temp)).toEqual([{ path: kept.snapshot, owner: kept.path }]);
  }, 60_000);

  /*
   * The snapshot links the checkout's `node_modules` into itself. Removal that
   * followed the link would empty a live checkout's dependencies, so this
   * removes a live checkout's snapshot directly and looks through the link.
   */
  it("removes a snapshot without following its link into the checkout", () => {
    const world = scratch();
    const live = auditedCheckout(world, "live");
    expect(lstatSync(join(live.snapshot, "node_modules")).isSymbolicLink()).toBe(true);

    removeSnapshot({ path: live.snapshot });

    expect(snapshotRemains(live.snapshot)).toBe(false);
    expect(existsSync(join(live.path, "node_modules", "keep-me"))).toBe(true);
  }, 60_000);
});
