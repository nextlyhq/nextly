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
 * Which processes run where is a fixed fact in these tests too: each run
 * reads it from a script named by `NEXTLY_SWEEP_CWD_READER` that prints
 * `lsof -F n` output, so a test asks about the gates and never about how fast
 * this machine's `lsof` answers under load. One test reads the platform's own
 * reader, to show the real thing finds a real process.
 *
 * @module worktree.sweep.test
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
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

import { afterEach, describe, expect, it, vi } from "vitest";

import { isWrittenForSlot, recheckGate, settingsWithEnv, slotEnv, worktreeRecords } from "./worktree.mjs";
import {
  DAY_MS,
  buildActivityReason,
  countFreed,
  describeFreed,
  globCovers,
  ignoredWorkReason,
  inUseReasons,
  outputClassifier,
  lsofPath,
  parseLsofCwds,
  processCwds,
  readerCwds,
  removeIfStillFree,
  writtenSince,
} from "./worktree-sweep.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = ["worktree.mjs", "worktree-sweep.mjs", "bounded.mjs", "local-limits.mjs", "jsonc.mjs"];

/**
 * The scratch repository's turbo config: `dist` for every package, as the
 * repository declares builds, and `templates` for one package by name, as
 * create-nextly-app's build declares its own.
 */
const SCRATCH_TURBO = `{
  // Declared outputs are what the sweep counts as build output.
  "tasks": {
    "build": { "outputs": ["dist/**", "!dist/cache/**"] },
    "scratch-cli#build": { "outputs": ["dist/**", "templates/**"] }
  }
}
`;

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
    NEXTLY_SWEEP_CWD_READER: reader(dir, "quiet", "printf 'p1\\nfcwd\\nn/\\n'"),
  };
  mkdirSync(join(world.repo, "scripts"), { recursive: true });
  for (const name of SCRIPTS) copyFileSync(join(HERE, name), join(world.repo, "scripts", name));
  writeFileSync(join(world.repo, "package.json"), '{"name":"scratch","type":"module"}\n');
  writeFileSync(join(world.repo, "turbo.jsonc"), SCRATCH_TURBO);
  mkdirSync(join(world.repo, "tools", "cli"), { recursive: true });
  writeFileSync(join(world.repo, "tools", "cli", "package.json"), '{"name":"scratch-cli"}\n');
  writeFileSync(
    join(world.repo, ".gitignore"),
    "dist\nnode_modules\n.env.local\n.claude/settings.local.json\ntemplates\n.turbo\n"
  );
  writeFileSync(join(world.repo, "index.js"), "export const a = 1;\n");
  git(world, dir, "init", "-q", "--bare", world.origin);
  git(world, world.repo, "init", "-q", "-b", "main");
  git(world, world.repo, "add", ".");
  git(world, world.repo, "commit", "-q", "-m", "base");
  git(world, world.repo, "remote", "add", "origin", world.origin);
  git(world, world.repo, "push", "-q", "origin", "main");
  return world;
}

/** A process reader printing what `body` prints: the fixed fact a test sets for which process runs where. */
function reader(dir, name, body) {
  const path = join(dir, `${name}-reader.sh`);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** A reader saying one process runs in `cwd`. */
function busyIn(world, cwd) {
  return reader(world.dir, "busy", `printf 'p42\\nfcwd\\nn%s\\n' '${cwd}'`);
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

/**
 * Move back by `days` every time the sweep reads for a checkout's last use:
 * everything in the checkout, its build output included, and its HEAD, index
 * and HEAD's log. A test then writes whatever it wants to read as fresh.
 */
function leaveAlone(world, path, days) {
  const when = new Date(Date.now() - days * DAY_MS);
  const gitDir = git(world, path, "rev-parse", "--absolute-git-dir");
  for (const file of [join(gitDir, "HEAD"), join(gitDir, "index"), join(gitDir, "logs", "HEAD")]) {
    if (existsSync(file)) utimesSync(file, when, when);
  }
  ageTree(path, when);
}

function ageTree(dir, when) {
  for (const name of readdirSync(dir)) {
    const entry = join(dir, name);
    if (lstatSync(entry).isDirectory()) ageTree(entry, when);
    utimesSync(entry, when, when);
  }
  utimesSync(dir, when, when);
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

describe("which turbo output patterns cover a path", () => {
  it.each([
    ["dist/**", "dist"],
    ["dist/**", "dist/index.js"],
    ["templates/**", "templates/base/page.tsx"],
    ["**/*.tsbuildinfo", "src/.tsbuildinfo"],
  ])("%s covers %s", (pattern, path) => expect(globCovers(pattern, path)).toBe(true));

  it.each([
    ["dist/**", "distant"],
    ["dist/**", "src/dist"],
    ["**/*.tsbuildinfo", "tsbuildinfo.json"],
    ["dist/*.js", "dist/index.js"],
    ["{dist,out}/**", "dist"],
  ])("%s does not cover %s, so an unread shape keeps the path", (pattern, path) =>
    expect(globCovers(pattern, path)).toBe(false)
  );
});

describe("what a checkout's own turbo config calls build output", () => {
  const checkout = () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "worktree-sweep-turbo-")));
    scratchDirs.push(dir);
    writeFileSync(join(dir, "package.json"), '{"name":"root"}\n');
    writeFileSync(join(dir, "turbo.jsonc"), SCRATCH_TURBO);
    mkdirSync(join(dir, "tools", "cli"), { recursive: true });
    writeFileSync(join(dir, "tools", "cli", "package.json"), '{"name":"scratch-cli"}\n');
    mkdirSync(join(dir, "tools", "other"), { recursive: true });
    writeFileSync(join(dir, "tools", "other", "package.json"), '{"name":"other"}\n');
    return dir;
  };

  it("takes a package's declared output, and another package's only where that one declares it too", () => {
    const { isBuildOutput } = outputClassifier(checkout());
    expect(isBuildOutput("dist")).toBe(true);
    expect(isBuildOutput("tools/cli/templates")).toBe(true);
    expect(isBuildOutput("tools/other/templates")).toBe(false);
    expect(isBuildOutput("tools/other/dist")).toBe(true);
  });

  it("takes turbo's logs, the browser reports and the extra distDirs no task declares", () => {
    const { isBuildOutput } = outputClassifier(checkout());
    for (const path of [".turbo", "e2e/.playwright", "e2e/test-results", "lighthouse-reports", "apps/x/.next-e2e"]) {
      expect(isBuildOutput(path), path).toBe(true);
    }
  });

  it("calls dependencies and tool caches regenerated but never build output, and work neither", () => {
    const { isBuildOutput, isRegenerated } = outputClassifier(checkout());
    expect(isBuildOutput("tools/cli/node_modules")).toBe(false);
    expect(isRegenerated("tools/cli/node_modules")).toBe(true);
    expect(isRegenerated(".husky/_")).toBe(true);
    for (const path of [".env.local", "data/dev.db", "uploads"]) expect(isRegenerated(path), path).toBe(false);
  });

  it("declares nothing where the config cannot be read, so build output reads as work", () => {
    const dir = checkout();
    writeFileSync(join(dir, "turbo.jsonc"), "{ not json");
    expect(outputClassifier(dir).isBuildOutput("dist")).toBe(false);
  });
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

describe("ignored files that may be work", () => {
  const regenerated = path => ["dist", ".turbo", "node_modules"].includes(path);
  const judges = { isOwnSettings: path => path.endsWith(".claude/settings.local.json"), isRegenerated: regenerated };

  it("finds none where every ignored path is regenerated", () => {
    expect(ignoredWorkReason("/w/one", ["dist", ".turbo", "node_modules"], judges)).toBeNull();
  });

  it("names the paths that may be work, and counts the rest", () => {
    const ignored = [".env.local", "packages/nextly/data", "dist", "uploads", "notes.md"];
    expect(ignoredWorkReason("/w/one", ignored, judges)).toBe(
      "it holds ignored files that may be work: .env.local, packages/nextly/data, uploads and 1 more"
    );
  });

  it("lets the slot's own settings file through only when the predicate says it is untouched", () => {
    expect(ignoredWorkReason("/w/one", [".claude/settings.local.json"], judges)).toBeNull();
    const untouched = { ...judges, isOwnSettings: () => false };
    expect(ignoredWorkReason("/w/one", [".claude/settings.local.json"], untouched)).toMatch(/settings\.local\.json/);
  });
});

describe("the slot settings `worktree new` writes", () => {
  const written = settingsWithEnv(null, slotEnv(3));

  it("are recognised exactly as written", () => {
    expect(isWrittenForSlot(JSON.parse(JSON.stringify(written)))).toBe(true);
  });

  it.each([
    ["a port someone changed", { env: { ...written.env, PORT: "4000" } }],
    ["a variable missing", { env: { NEXTLY_WORKTREE_SLOT: "3", PORT: written.env.PORT } }],
    ["an empty env", { env: {} }],
    ["a key someone added", { ...written, permissions: { allow: ["Bash"] } }],
    ["another slot's values under this slot's number", { env: { ...slotEnv(4), NEXTLY_WORKTREE_SLOT: "3" } }],
  ])("are not recognised with %s", (_, settings) => expect(isWrittenForSlot(settings)).toBe(false));
});

describe("the size a run reports", () => {
  it("counts a removal it could not size as unknown, not as nothing", () => {
    const tally = { freed: 0, unknown: 0 };
    countFreed(tally, 2 * 1024 ** 3);
    countFreed(tally, null);
    countFreed(tally, undefined);
    expect(describeFreed("would free", tally)).toBe("would free 2.0 GB in all, plus 2 of unknown size");
  });

  it("says nothing of unknown sizes when every size was read", () => {
    expect(describeFreed("freed", { freed: 0, unknown: 0 })).toBe("freed 0 MB in all");
  });
});

describe("when build output was last written", () => {
  it("sees a file overwritten inside an old directory, which moves no directory's time", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "worktree-sweep-built-")));
    scratchDirs.push(dir);
    mkdirSync(join(dir, "dist", "chunks"), { recursive: true });
    writeFileSync(join(dir, "dist", "chunks", "a.js"), "old\n");
    ageTree(dir, new Date(Date.now() - 10 * DAY_MS));
    const since = Date.now() - 3 * DAY_MS;
    expect(writtenSince(join(dir, "dist"), since)).toBe(false);

    writeFileSync(join(dir, "dist", "chunks", "a.js"), "rebuilt\n");

    expect(writtenSince(join(dir, "dist"), since)).toBe(true);
    expect(buildActivityReason(dir, ["dist"], 3, Date.now())).toBe("its build output was written within 3 d");
  });

  it("answers null, so the gate skips, past the entry limit or for a path it cannot read", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "worktree-sweep-many-")));
    scratchDirs.push(dir);
    for (const name of ["a", "b", "c"]) writeFileSync(join(dir, name), "x\n");
    ageTree(dir, new Date(Date.now() - 10 * DAY_MS));
    expect(writtenSince(dir, Date.now() - DAY_MS, 2)).toBeNull();
    expect(writtenSince(join(dir, "missing"), Date.now() - DAY_MS)).toBeNull();
    expect(buildActivityReason(dir, ["missing"], 3, Date.now())).toBe("cannot tell when its build output was last written");
  });
});

describe("reading which process runs where", () => {
  const timedOut = () => ({ error: Object.assign(new Error("spawnSync lsof ETIMEDOUT"), { code: "ETIMEDOUT" }), status: null, stdout: "" });
  const answered = () => ({ status: 0, stdout: "p1\nfcwd\nn/w/one\n" });

  it("tries once more when the first read times out, and takes the second answer", () => {
    const answers = [timedOut(), answered()];
    const run = vi.fn(() => answers.shift());
    expect(readerCwds("/usr/sbin/lsof", ["-F", "n"], run)).toEqual(["/w/one"]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][2].timeout).toBe(30_000);
  });

  it("answers null, so every checkout reads as in use, when both reads time out", () => {
    const run = vi.fn(timedOut);
    expect(readerCwds("/usr/sbin/lsof", ["-F", "n"], run)).toBeNull();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("answers null for a read that prints nothing, rather than reading it as no process anywhere", () => {
    expect(readerCwds("lsof", [], () => ({ status: 0, stdout: "" }))).toBeNull();
  });

  it("asks lsof by the path macOS installs it at, whatever PATH holds", () => {
    expect(lsofPath(path => path === "/usr/sbin/lsof")).toBe("/usr/sbin/lsof");
    expect(lsofPath(() => false)).toBe("lsof");
  });
});

describe("asking again just before a removal", () => {
  it("does not remove a candidate that is in use by now, whatever the first look said", async () => {
    const remove = vi.fn(() => ({ removed: true }));
    const outcome = await removeIfStillFree(
      { path: "/w/one/dist", checkout: "/w/one" },
      { recheck: async () => ["a process runs inside it (/w/one)"], remove }
    );
    expect(remove).not.toHaveBeenCalled();
    expect(outcome).toEqual({ removed: false, skipped: true, reason: "in use by now: a process runs inside it (/w/one)" });
  });

  it("reads every fact again for each candidate, even two in one checkout a moment apart", async () => {
    const facts = [
      { processCwds: [], heldCwds: [], now: Date.now() },
      { processCwds: ["/w/one"], heldCwds: [], now: Date.now() },
    ];
    const recheck = recheckGate([], () => facts.shift());
    const candidate = path => ({
      path,
      checkout: "/w/one",
      idleDays: 3,
      readLastActive: () => Date.now() - 10 * DAY_MS,
      lateReasons: () => [],
    });
    expect(await recheck(candidate("/w/one/dist"))).toEqual([]);
    expect(await recheck(candidate("/w/one/coverage"))).toEqual(["a process runs inside it (/w/one)"]);
  });

  it("asks a candidate's own late reasons again, such as build output written since it was found", async () => {
    const recheck = recheckGate([], () => ({ processCwds: [], heldCwds: [], now: Date.now() }));
    const reasons = await recheck({
      checkout: "/w/one",
      idleDays: 3,
      readLastActive: () => Date.now() - 10 * DAY_MS,
      lateReasons: () => ["its build output was written within 3 d"],
    });
    expect(reasons).toEqual(["its build output was written within 3 d"]);
  });

  it("removes it when the second look still finds nothing", async () => {
    const remove = vi.fn(() => ({ removed: true }));
    const outcome = await removeIfStillFree({ path: "/w/one/dist" }, { recheck: async () => [], remove });
    expect(remove).toHaveBeenCalledOnce();
    expect(outcome).toEqual({ removed: true });
  });
});

describe.runIf(process.platform !== "win32")("worktree sweep on real checkouts", () => {
  it("only reports without --apply: nothing on disk changes, though there is something to remove", () => {
    const world = scratch();
    const merged = checkout(world, "merged");
    mkdirSync(join(merged.path, "dist"));
    writeFileSync(join(merged.path, "dist", "index.js"), "built\n");
    merged.age();
    // A branch with its own commit while main moved on independently: the
    // comparison with main must not write a merged tree into the object store.
    const ahead = checkout(world, "ahead");
    writeFileSync(join(ahead.path, "branch.js"), "export const b = 1;\n");
    git(world, ahead.path, "add", "branch.js");
    git(world, ahead.path, "commit", "-q", "-m", "branch work");
    writeFileSync(join(world.repo, "main.js"), "export const m = 1;\n");
    git(world, world.repo, "add", "main.js");
    git(world, world.repo, "commit", "-q", "-m", "main work");
    git(world, world.repo, "push", "-q", "origin", "main");
    ahead.age();
    const before = treeHash(world.dir);

    const { code, stdout } = worktreeCommand(world, "sweep", "--stale", "--builds");

    expect(code, stdout).toBe(0);
    // The controls: there was something it would have removed, and the
    // branch with its own work was compared with main.
    expect(stdout).toContain(`would remove ${merged.path}`);
    expect(stdout).toContain(`skipped ${ahead.path}: 1 commit(s) on no remote and not in origin/main`);
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

  it("leaves a checkout a process is running in, beside one it does remove", () => {
    const world = scratch();
    const busy = checkout(world, "busy");
    busy.age();
    const merged = checkout(world, "merged");
    merged.age();
    world.env.NEXTLY_SWEEP_CWD_READER = busyIn(world, busy.path);

    const { stdout } = worktreeCommand(world, "sweep", "--stale", "--apply");

    expect(existsSync(merged.path), stdout).toBe(false);
    expect(existsSync(busy.path)).toBe(true);
    expect(stdout).toContain(`skipped ${busy.path}: a process runs inside it`);
  }, 60_000);

  it("removes nothing when the process reader does not answer, and says it cannot tell", () => {
    const world = scratch();
    const merged = checkout(world, "merged");
    mkdirSync(join(merged.path, "dist"));
    writeFileSync(join(merged.path, "dist", "index.js"), "built\n");
    merged.age();
    const idle = checkout(world, "idle");
    mkdirSync(join(idle.path, "dist"));
    writeFileSync(join(idle.path, "dist", "index.js"), "built\n");
    idle.age();
    // A reader that fails as lsof does when it cannot run, with nothing printed.
    world.env.NEXTLY_SWEEP_CWD_READER = reader(world.dir, "broken", "exit 2");
    const before = treeHash(world.dir);

    const { code, stdout } = worktreeCommand(world, "sweep", "--stale", "--builds", "--apply");

    expect(code, stdout).toBe(0);
    expect(stdout).toContain(`skipped ${merged.path}: cannot tell which processes run inside it`);
    expect(stdout).toContain(`skipped ${idle.path} (1 build output path(s)): cannot tell which processes run inside it`);
    expect(stdout).not.toContain("  removed ");
    expect(treeHash(world.dir)).toBe(before);
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
  it("leaves a stale checkout holding ignored work, which git would delete, beside one it removes", () => {
    const world = scratch();
    const kept = checkout(world, "kept");
    writeFileSync(join(kept.path, ".env.local"), "SECRET=only-here\n");
    kept.age();
    const merged = checkout(world, "merged");
    merged.age();

    const { stdout } = worktreeCommand(world, "sweep", "--stale", "--apply");

    expect(existsSync(merged.path), stdout).toBe(false);
    expect(readFileSync(join(kept.path, ".env.local"), "utf8")).toContain("only-here");
    expect(stdout).toContain(`skipped ${kept.path}: it holds ignored files that may be work: .env.local`);
  }, 60_000);

  it("removes a stale checkout whose only ignored file is the slot settings exactly as written, and keeps edited ones", () => {
    const world = scratch();
    const withSettings = (branch, settings) => {
      const made = checkout(world, branch);
      mkdirSync(join(made.path, ".claude"));
      writeFileSync(join(made.path, ".claude", "settings.local.json"), `${JSON.stringify(settings, null, 2)}\n`);
      made.age();
      return made;
    };
    const written = settingsWithEnv(null, slotEnv(3));
    const merged = withSettings("merged", written);
    const port = withSettings("port", { env: { ...written.env, PORT: "4000" } });
    const partial = withSettings("partial", { env: { NEXTLY_WORKTREE_SLOT: "3", PORT: written.env.PORT } });

    const { stdout } = worktreeCommand(world, "sweep", "--stale", "--apply");

    expect(existsSync(merged.path), stdout).toBe(false);
    for (const kept of [port, partial]) {
      expect(existsSync(join(kept.path, ".claude", "settings.local.json")), kept.path).toBe(true);
    }
  }, 60_000);

  it("leaves a checkout whose only unpushed change is a file git quotes in line output", () => {
    const world = scratch();
    const quoted = checkout(world, "quoted");
    writeFileSync(join(quoted.path, "café.js"), "export const only = 'here';\n");
    git(world, quoted.path, "add", "café.js");
    git(world, quoted.path, "commit", "-q", "-m", "a name git quotes");
    quoted.age();
    const merged = checkout(world, "merged");
    merged.age();

    const { stdout } = worktreeCommand(world, "sweep", "--stale", "--apply");

    expect(existsSync(merged.path), stdout).toBe(false);
    expect(existsSync(join(quoted.path, "café.js"))).toBe(true);
    expect(stdout).toContain(`skipped ${quoted.path}: 1 commit(s) on no remote and not in origin/main`);
  }, 60_000);

  it("removes the output a package's own build declares, and keeps the same name in a package that does not", () => {
    const world = scratch();
    const idle = checkout(world, "idle");
    mkdirSync(join(idle.path, "tools", "cli", "templates"), { recursive: true });
    writeFileSync(join(idle.path, "tools", "cli", "templates", "page.tsx"), "copied\n");
    mkdirSync(join(idle.path, "templates"), { recursive: true });
    writeFileSync(join(idle.path, "templates", "mine.tsx"), "someone's own\n");
    idle.age();

    const { stdout } = worktreeCommand(world, "sweep", "--builds", "--apply");

    expect(existsSync(join(idle.path, "tools", "cli", "templates")), stdout).toBe(false);
    expect(existsSync(join(idle.path, "templates", "mine.tsx"))).toBe(true);
  }, 60_000);

  it("leaves build output rebuilt in place in a checkout whose git state is old", () => {
    const world = scratch();
    const rebuilt = checkout(world, "rebuilt");
    mkdirSync(join(rebuilt.path, "dist"));
    writeFileSync(join(rebuilt.path, "dist", "index.js"), "built\n");
    rebuilt.age();
    // A build overwrites a file in place: no directory's time moves.
    writeFileSync(join(rebuilt.path, "dist", "index.js"), "rebuilt\n");

    const { stdout } = worktreeCommand(world, "sweep", "--builds", "--apply");

    expect(existsSync(join(rebuilt.path, "dist", "index.js")), stdout).toBe(true);
    expect(stdout).toContain("its build output was written within 3 d");
  }, 60_000);
  it("never touches the fallow snapshot of a live checkout, however long it has sat idle", () => {
    const world = scratch();
    const live = checkout(world, "live");
    writeFileSync(join(live.path, "index.js"), "export const a = 'in progress';\n");
    // A snapshot fallow keeps for the live checkout: its directory and the
    // owner record naming that checkout, both long untouched.
    const snapshot = join(world.dir, "tmp", "fallow-audit-base-cache-live");
    mkdirSync(join(snapshot, "src"), { recursive: true });
    writeFileSync(join(snapshot, "src", "index.js"), "base\n");
    writeFileSync(`${snapshot}.last-used`, live.path);
    live.age();
    ageTree(join(world.dir, "tmp"), new Date(Date.now() - 10 * DAY_MS));

    const { stdout } = worktreeCommand(world, "sweep", "--stale", "--builds", "--apply");

    expect(existsSync(join(snapshot, "src", "index.js")), stdout).toBe(true);
    expect(existsSync(`${snapshot}.last-used`)).toBe(true);
  }, 60_000);
  it("removes two output paths of one checkout, rechecking the second without the first it just removed", () => {
    const world = scratch();
    const idle = checkout(world, "idle");
    for (const dir of ["dist", ".turbo"]) {
      mkdirSync(join(idle.path, dir));
      writeFileSync(join(idle.path, dir, "out.txt"), "built\n");
    }
    idle.age();

    const { code, stdout } = worktreeCommand(world, "sweep", "--builds", "--apply");

    expect(code, stdout).toBe(0);
    expect(existsSync(join(idle.path, "dist")), stdout).toBe(false);
    expect(existsSync(join(idle.path, ".turbo")), stdout).toBe(false);
    expect(stdout).not.toContain("cannot tell when its build output was last written");
  }, 60_000);
});

/**
 * The platform's own reader, against a real process: `lsof` by its absolute
 * path on macOS, `/proc` on Linux. It is skipped only where there is no reader
 * to run at all, never because it is slow: it is given its full bound.
 */
const ownReader =
  process.platform === "darwin" ? spawnSync(lsofPath(), ["-v"]).error?.code !== "ENOENT" : existsSync("/proc");

describe.runIf(process.platform !== "win32" && ownReader)("the platform's own process reader", () => {
  it("finds a process whose directory is inside a checkout", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "worktree-sweep-reader-")));
    scratchDirs.push(dir);
    const child = spawn("sleep", ["60"], { cwd: dir, stdio: "ignore" });
    children.push(child);
    await new Promise(done => child.once("spawn", done));

    const cwds = processCwds(process.platform, {});

    expect(cwds, "the reader did not answer").not.toBeNull();
    expect(cwds.map(cwd => (existsSync(cwd) ? realpathSync(cwd) : cwd))).toContain(dir);
  }, 120_000);
});

