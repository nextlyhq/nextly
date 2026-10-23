/**
 * What `worktree sweep` reclaims from idle checkouts, and what it never
 * touches, checked against real checkouts in a scratch repository.
 *
 * The property that separates a safe sweep from a plausible broken one is
 * what it LEAVES: a sweep that removed every idle checkout would pass any test
 * that only asked whether something was freed. So each way a checkout can
 * hold someone's work — an uncommitted change, a commit that is nowhere else,
 * a process running in it — has a test that runs `--apply` and finds it still
 * in place, beside a positive control that the same run does remove a clean,
 * merged, idle one. Without the control, every "left in place" assertion
 * would pass on a sweep that removed nothing at all.
 *
 * The commands run as a copy of the scripts inside a scratch repository with
 * its own bare `origin`, because the script acts on the repository it sits
 * in. `TMPDIR` and `NEXTLY_HEAVY_SLOT_DIR` point into the scratch directory, so
 * neither this machine's fallow snapshots nor its running heavy jobs reach a
 * test. The scratch checkouts hold no slot claim, so a removal treats them as
 * slot 0, whose databases are never dropped.
 *
 * @module worktree.sweep.test
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { worktreeRecords } from "./worktree.mjs";
import { DAY_MS, inUseReasons, isBuildOutput, parseLsofCwds } from "./worktree-sweep.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = ["worktree.mjs", "worktree-sweep.mjs", "bounded.mjs", "local-limits.mjs"];

const scratchDirs = [];
const children = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A repository holding a copy of the scripts, with `main` pushed to a bare
 * `origin` so a checkout's work can be on a remote or not.
 */
function scratch() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "worktree-sweep-")));
  scratchDirs.push(dir);
  const world = { dir, repo: join(dir, "repo"), origin: join(dir, "origin.git") };
  mkdirSync(join(dir, "tmp"));
  // None of the developer's git settings, no hook's GIT_DIR, and a temporary
  // directory and heavy-slot directory of the scratch run's own.
  world.env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    TMPDIR: join(dir, "tmp"),
    NEXTLY_HEAVY_SLOT_DIR: join(dir, "slots"),
  };
  mkdirSync(join(world.repo, "scripts"), { recursive: true });
  for (const name of SCRIPTS) copyFileSync(join(HERE, name), join(world.repo, "scripts", name));
  writeFileSync(join(world.repo, "package.json"), '{"name":"scratch","type":"module"}\n');
  writeFileSync(join(world.repo, ".gitignore"), "dist\nnode_modules\n.env.local\n");
  writeFileSync(join(world.repo, "index.js"), "export const a = 1;\n");
  git(world, dir, "init", "-q", "--bare", world.origin);
  git(world, world.repo, "init", "-q", "-b", "main");
  git(world, world.repo, "add", ".");
  git(world, world.repo, "commit", "-q", "-m", "base");
  git(world, world.repo, "remote", "add", "origin", world.origin);
  git(world, world.repo, "push", "-q", "origin", "main");
  return world;
}

function git(world, cwd, ...args) {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd,
    encoding: "utf8",
    env: world.env,
  }).trim();
}

/** A checkout on its own branch at `main`, to be left alone for `days`. */
function checkout(world, branch, days = 10) {
  const path = join(world.dir, branch);
  git(world, world.repo, "worktree", "add", "-q", "-b", branch, path, "main");
  return { path, branch, age: () => leaveAlone(world, path, days) };
}

/** Move every time the sweep reads a checkout's last use back by `days`. */
function leaveAlone(world, path, days) {
  const when = new Date(Date.now() - days * DAY_MS);
  const gitDir = git(world, path, "rev-parse", "--absolute-git-dir");
  for (const file of [path, join(gitDir, "HEAD"), join(gitDir, "index"), join(gitDir, "logs", "HEAD")]) {
    if (existsSync(file)) utimesSync(file, when, when);
  }
}

/** Run the scratch copy of the script and collect what it did, rather than what it threw. */
function worktreeCommand(world, ...args) {
  const run = spawnSync(process.execPath, [join(world.repo, "scripts", "worktree.mjs"), ...args], {
    cwd: world.repo,
    encoding: "utf8",
    env: world.env,
  });
  return { code: run.status, stdout: `${run.stdout}${run.stderr}` };
}

/** Every path under `dir` with its mode, size and modified time, hashed: equal means nothing changed. */
function treeHash(dir) {
  const hash = createHash("sha256");
  const walk = current => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const info = lstatSync(path);
      hash.update(`${path}\0${info.mode}\0${info.size}\0${info.mtimeMs}\n`);
      if (info.isDirectory()) walk(path);
    }
  };
  walk(dir);
  return hash.digest("hex");
}

describe("which ignored paths are build output", () => {
  it.each(["packages/nextly/dist/", "apps/playground/.next", "apps/playground/.next-e2e/", ".turbo", "coverage/"])(
    "takes %s",
    path => expect(isBuildOutput(path)).toBe(true)
  );

  it.each([".env.local", "data/dev.db", "node_modules/", "packages/x/node_modules/pkg/dist/", ".nextly-local"])(
    "never takes %s, which is work, a reinstall, or someone else's",
    path => expect(isBuildOutput(path)).toBe(false)
  );
});

describe("the in-use gate", () => {
  const now = Date.now();
  const idle = { processCwds: [], heldCwds: [], answering: [], lastActive: now - 10 * DAY_MS, idleDays: 7, now };

  it("lets an idle checkout nobody is in through", () => {
    expect(inUseReasons("/w/one", idle)).toEqual([]);
  });

  it("refuses when it cannot tell which processes run inside, rather than assuming none do", () => {
    expect(inUseReasons("/w/one", { ...idle, processCwds: null })).toEqual([
      "cannot tell which processes run inside it",
    ]);
  });

  it("refuses for a process below the checkout, and not for one in a sibling that shares a prefix", () => {
    expect(inUseReasons("/w/one", { ...idle, processCwds: ["/w/one/packages/x"] })).toHaveLength(1);
    expect(inUseReasons("/w/one", { ...idle, processCwds: ["/w/one-more"] })).toEqual([]);
  });

  it("refuses for a heavy job there, and for one whose directory is not known yet", () => {
    expect(inUseReasons("/w/one", { ...idle, heldCwds: ["/w/one"] })).toEqual([
      "a heavy job holds a bounded slot there",
    ]);
    expect(inUseReasons("/w/one", { ...idle, heldCwds: [null] })).toEqual([
      "a heavy job is starting and its directory is not known yet",
    ]);
  });

  it("refuses when its slot's port answers, or when it was used within the threshold", () => {
    expect(inUseReasons("/w/one", { ...idle, answering: [3210] })).toEqual(["its slot's port 3210 answers"]);
    expect(inUseReasons("/w/one", { ...idle, lastActive: now - DAY_MS })[0]).toMatch(/under 7 d idle/);
    expect(inUseReasons("/w/one", { ...idle, lastActive: null })).toEqual(["cannot read when it was last used"]);
  });
});

describe("reading the facts the gate is given", () => {
  it("reads each process's directory out of lsof's field output", () => {
    expect(parseLsofCwds("p12\nfcwd\nn/w/one\np13\nfcwd\nn/w/two b\n")).toEqual(["/w/one", "/w/two b"]);
  });

  it("marks a locked or prunable checkout, and leaves other records as they were", () => {
    const porcelain = [
      "worktree /r",
      "branch refs/heads/main",
      "",
      "worktree /a",
      "branch refs/heads/a",
      "locked in use",
      "",
      "worktree /b",
      "detached",
      "prunable gitdir file points to non-existent location",
    ].join("\n");
    expect(worktreeRecords(porcelain)).toEqual([
      { path: "/r", branch: "main" },
      { path: "/a", branch: "a", locked: true },
      { path: "/b", branch: null, prunable: true },
    ]);
  });
});

describe.runIf(process.platform !== "win32")("worktree sweep on real checkouts", () => {
  it("only reports without --apply: nothing on disk changes, though there is something to remove", () => {
    const world = scratch();
    const merged = checkout(world, "merged");
    mkdirSync(join(merged.path, "dist"));
    writeFileSync(join(merged.path, "dist", "index.js"), "built\n");
    merged.age();
    const before = treeHash(world.dir);

    const { code, stdout } = worktreeCommand(world, "sweep", "--stale", "--builds");

    expect(code, stdout).toBe(0);
    // The control: there was something it would have removed.
    expect(stdout).toContain(`would remove ${merged.path}`);
    expect(treeHash(world.dir)).toBe(before);
  }, 60_000);

  it("removes a clean, idle checkout whose work is on the remote, through `worktree remove`", () => {
    const world = scratch();
    const merged = checkout(world, "merged");
    merged.age();

    const { code, stdout } = worktreeCommand(world, "sweep", "--stale", "--apply");

    expect(code, stdout).toBe(0);
    expect(existsSync(merged.path)).toBe(false);
    expect(stdout).toContain(`removed ${merged.path}`);
    const log = readFileSync(join(world.repo, ".git", "nextly-sweep.log"), "utf8");
    expect(log).toContain("\tcheckout\t");
    expect(log).toContain(merged.path);
  }, 60_000);

  it("removes one whose commits are on no remote but whose content main has, as a squash merge leaves it", () => {
    const world = scratch();
    const squashed = checkout(world, "squashed");
    writeFileSync(join(squashed.path, "index.js"), "export const a = 2;\n");
    git(world, squashed.path, "commit", "-q", "-am", "change");
    // The same change lands on main as a different commit, and is pushed.
    writeFileSync(join(world.repo, "index.js"), "export const a = 2;\n");
    git(world, world.repo, "commit", "-q", "-am", "change (#1)");
    git(world, world.repo, "push", "-q", "origin", "main");
    squashed.age();

    const { code, stdout } = worktreeCommand(world, "sweep", "--stale", "--apply");

    expect(code, stdout).toBe(0);
    expect(existsSync(squashed.path)).toBe(false);
  }, 60_000);

  it("leaves a checkout holding an uncommitted change, beside one it does remove", () => {
    const world = scratch();
    const dirty = checkout(world, "dirty");
    writeFileSync(join(dirty.path, "index.js"), "export const a = 'unsaved';\n");
    dirty.age();
    const merged = checkout(world, "merged");
    merged.age();

    const { stdout } = worktreeCommand(world, "sweep", "--stale", "--apply");

    expect(existsSync(merged.path), stdout).toBe(false);
    expect(existsSync(dirty.path)).toBe(true);
    expect(readFileSync(join(dirty.path, "index.js"), "utf8")).toContain("unsaved");
    expect(stdout).toContain(`skipped ${dirty.path}: it has uncommitted or untracked changes`);
  }, 60_000);

  it("leaves a checkout holding a commit that is on no remote and not in main, beside one it does remove", () => {
    const world = scratch();
    const ahead = checkout(world, "ahead");
    writeFileSync(join(ahead.path, "index.js"), "export const a = 'only here';\n");
    git(world, ahead.path, "commit", "-q", "-am", "unpushed");
    ahead.age();
    const merged = checkout(world, "merged");
    merged.age();

    const { stdout } = worktreeCommand(world, "sweep", "--stale", "--apply");

    expect(existsSync(merged.path), stdout).toBe(false);
    expect(existsSync(ahead.path)).toBe(true);
    expect(git(world, ahead.path, "log", "-1", "--format=%s")).toBe("unpushed");
    expect(stdout).toContain(`skipped ${ahead.path}: 1 commit(s) on no remote and not in origin/main`);
  }, 60_000);

  it("leaves a checkout a process is running in, beside one it does remove", async () => {
    const world = scratch();
    const busy = checkout(world, "busy");
    busy.age();
    const merged = checkout(world, "merged");
    merged.age();
    const child = spawn("sleep", ["60"], { cwd: busy.path, stdio: "ignore" });
    children.push(child);
    await new Promise(done => child.once("spawn", done));

    const { stdout } = worktreeCommand(world, "sweep", "--stale", "--apply");

    expect(existsSync(merged.path), stdout).toBe(false);
    expect(existsSync(busy.path)).toBe(true);
    expect(stdout).toContain(`skipped ${busy.path}: a process runs inside it`);
  }, 60_000);

  it("removes an idle checkout's build output with --builds, and leaves its other ignored files and its work", () => {
    const world = scratch();
    const idle = checkout(world, "idle");
    mkdirSync(join(idle.path, "dist"));
    writeFileSync(join(idle.path, "dist", "index.js"), "built\n");
    writeFileSync(join(idle.path, ".env.local"), "SECRET=kept\n");
    idle.age();

    const { code, stdout } = worktreeCommand(world, "sweep", "--builds", "--apply");

    expect(code, stdout).toBe(0);
    expect(existsSync(join(idle.path, "dist"))).toBe(false);
    expect(existsSync(join(idle.path, ".env.local"))).toBe(true);
    expect(existsSync(join(idle.path, "index.js"))).toBe(true);
    expect(readdirSync(idle.path).some(name => name.includes("nextly-trash"))).toBe(false);
  }, 60_000);

  it("leaves the build output of a checkout used within the threshold", () => {
    const world = scratch();
    const recent = checkout(world, "recent", 1);
    mkdirSync(join(recent.path, "dist"));
    recent.age();

    const { stdout } = worktreeCommand(world, "sweep", "--builds", "--apply");

    expect(existsSync(join(recent.path, "dist")), stdout).toBe(true);
    expect(stdout).toMatch(/under 3 d idle/);
  }, 60_000);
});
