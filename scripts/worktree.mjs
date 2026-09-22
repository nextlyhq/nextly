#!/usr/bin/env node

/**
 * Give each worktree its own ports and its own test databases.
 *
 * Several agents working at once need several checkouts, and this repository
 * has things that are shared per-machine rather than per-checkout. Two are
 * obvious: the playground and the Playwright suites bind fixed ports.
 *
 * 🔴 The third is not obvious and fails silently. Integration suites give
 * TEST-OWNED tables a random per-file prefix, which makes files independent —
 * but Nextly's SYSTEM tables have fixed names (`nextly_schema_events` and its
 * neighbours) and cannot be prefixed. Inside one run that is handled by
 * `fileParallelism: false`. Across two worktrees it is not handled at all:
 * both point at `nextly_test` on the same container, and the second run drops
 * and recreates a system table the first is still using. The result reads as a
 * flaky test rather than as a collision.
 *
 * So the isolation is a separate DATABASE per worktree rather than a prefix,
 * and a slot is what names it.
 *
 * Anything that ALLOCATES has a teardown path in the same file: `new` takes a
 * checkout, a block of ports and a database on each running container, and
 * `remove` gives them back. A create with no matching remove leaks whatever is
 * scarce, and slots are a small pool.
 *
 * Usage:
 *   node scripts/worktree.mjs new <branch> [--from <ref>] [--root <dir>]
 *   node scripts/worktree.mjs list
 *   node scripts/worktree.mjs remove <branch|path> [--keep-branch] [--force]
 *   node scripts/worktree.mjs provision
 *   node scripts/worktree.mjs sweep
 *   node scripts/worktree.mjs env [--slot <n>]
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The ports slot 0 uses, which are the repository's documented defaults.
 *
 * Slot 0 is the primary checkout, and it must keep these exactly: `AGENTS.md`,
 * `e2e/playwright.config.ts` and `e2e/playwright.production.config.ts` all
 * name them, so changing them here would invalidate every one of those.
 */
export const DEFAULT_PORTS = { PORT: 3000, E2E_PORT: 3100, E2E_PROD_PORT: 3101 };

/**
 * Every server port a checkout binds, in the order a slot's block assigns them.
 *
 * 🔴 `E2E_PROD_PORT` was missing from the first version, so two worktrees
 * running the production Playwright suite collided on 3101 despite holding
 * different slots. A port that is not in this list is not allocated, and
 * nothing says so — the collision simply happens.
 */
export const PORT_NAMES = ["PORT", "E2E_PORT", "E2E_PROD_PORT"];

/**
 * Where allocated slots start, and how many ports each one owns.
 *
 * 🔴 The first version gave each port its own arithmetic series — playground
 * at 3000 + 10n and e2e at 3100 + 10n — and the series INTERSECT: slot 10's
 * playground port is 3100, which is slot 0's e2e port. Independent series look
 * separated at the slots anyone tries by hand and collide further out.
 *
 * A contiguous block per slot cannot have that shape. The base sits above every
 * default in `DEFAULT_PORTS`, so an allocated slot can never reach one either.
 */
export const SLOT_PORT_BASE = 3200;
export const PORTS_PER_SLOT = 10;

/** The database name a slot owns. */
export const DATABASE_BASE = "nextly_test";

/** The test containers a worktree needs a database inside. */
export const TEST_DATABASES = [
  { container: "nextly-postgres17-test", engine: "postgres" },
  { container: "nextly-postgres15-test", engine: "postgres" },
  { container: "nextly-mysql-test", engine: "mysql" },
];

/** How many slots may be claimed at once. */
export const MAX_SLOTS = 64;

export function databaseFor(slot) {
  return slot === 0 ? DATABASE_BASE : `${DATABASE_BASE}_w${slot}`;
}

/**
 * The slot a `--slot` argument names, or null if it names no slot at all.
 *
 * `Number()` accepts far more than a slot can be. `--slot nope` and a bare
 * `--slot` both became NaN, and `worktree env` then printed `PORT=NaN` and
 * `NEXTLY_TEST_DB=nextly_test_wNaN` and exited 0. Sourcing that output leaves
 * the servers on their slot-0 defaults while the integration lanes look for a
 * database that cannot exist and self-skip — which reads as a pass. Both
 * halves of the isolation are gone and nothing says so.
 *
 * Digits only, so `-1`, `1.5`, `1e3` and `0x2` are all refused rather than
 * silently truncated into a slot that exists.
 */
export function parseSlot(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const slot = Number(value);
  return slot < MAX_SLOTS ? slot : null;
}

/** The ports a slot owns. Slot 0 is the documented defaults, verbatim. */
export function portsFor(slot) {
  if (slot === 0) return { ...DEFAULT_PORTS };
  const base = SLOT_PORT_BASE + (slot - 1) * PORTS_PER_SLOT;
  return Object.fromEntries(PORT_NAMES.map((name, index) => [name, base + index]));
}

/** Everything a slot decides, as environment variables. */
export function slotEnv(slot) {
  const ports = portsFor(slot);
  return {
    NEXTLY_WORKTREE_SLOT: String(slot),
    // The DATABASE, not a URL. Each dialect leg keeps its own port — postgres15
    // is on 5434 and postgres17 on 5435 — so a single TEST_POSTGRES_URL in the
    // environment would silently point the `:postgres15` leg at the 17
    // container and report a pass for a version it never ran against.
    NEXTLY_TEST_DB: databaseFor(slot),
    ...Object.fromEntries(Object.entries(ports).map(([k, v]) => [k, String(v)])),
  };
}

/**
 * Run git with the hook environment cleared.
 *
 * Git exports GIT_DIR into every hook, and in a linked worktree it names that
 * worktree's admin directory rather than a plain `.git`. This script is run
 * from a terminal today, but nothing stops a hook calling it, and this
 * repository has already lost time to a turbo invocation that inherited that
 * pointer and never returned. Clearing it costs nothing: with no GIT_DIR set,
 * git discovers the repository from the working directory.
 */
function git(args, cwd = root) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return execFileSync("git", args, { cwd, encoding: "utf8", env }).trim();
}

/**
 * Git's worktree listing, as records rather than a list of paths.
 *
 * 🔴 Removal used to match a branch by testing whether a checkout's PATH ended
 * with the branch name, and a path suffix is not a branch: asking to remove
 * `feature` matched a checkout of `fix-feature` and force-deleted the wrong
 * one. The porcelain output states the branch outright, so read it.
 */
export function worktreeRecords(porcelain) {
  const records = [];
  let current = null;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length), branch: null };
      records.push(current);
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
  }
  return records;
}

/** Kept for callers that only need the paths. */
export function worktreePaths(porcelain) {
  return worktreeRecords(porcelain).map(record => record.path);
}

/**
 * The checkout a removal target names — by exact branch, or by exact path.
 *
 * Returns null rather than a best guess. A removal that destroys a checkout is
 * not a place for fuzzy matching.
 */
export function findWorktree(records, target, resolvePath = resolve) {
  const byBranch = records.filter(record => record.branch === target);
  if (byBranch.length === 1) return byBranch[0];
  const wanted = resolvePath(target);
  const byPath = records.filter(record => resolvePath(record.path) === wanted);
  return byPath.length === 1 ? byPath[0] : null;
}

/** Where slot claims live: the shared admin directory, so every worktree agrees. */
export function claimDir(commonDir) {
  return join(commonDir, "nextly-worktree-slots");
}

/**
 * Whether a claim no longer describes anything, and may be taken over.
 *
 * `pendingCleanup` is the important case. A removal whose databases could NOT
 * be dropped leaves the claim behind deliberately, so the slot is not reissued
 * while a populated `nextly_test_w<n>` still exists — reissuing it would hand
 * the next checkout another run's system tables, which is the collision this
 * whole mechanism exists to prevent.
 */
export function isReclaimable(claim, exists = existsSync) {
  // 🔴 An unreadable claim used to read as reclaimable, and that is the
  // dangerous direction. A claim being written, or one truncated by a crash,
  // parses as null — so a concurrent run could unlink it and take a slot its
  // owner believed it held. "I cannot tell who owns this" is not "nobody owns
  // this"; the ambiguous case keeps the slot, and `worktree sweep` is where a
  // genuinely orphaned one is cleared deliberately.
  if (claim === null) return false;
  if (claim.pendingCleanup) return false;
  return !exists(claim.path);
}

function readClaim(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Take the lowest free slot, atomically.
 *
 * 🔴 The first version read the worktree list, picked the lowest free number,
 * and then wrote the settings file — three steps with nothing holding between
 * them. Two agents running `worktree new` at the same time both read the same
 * list and both chose the same slot, so the two checkouts got identical ports
 * and an identical database. That is exactly the collision the slot mechanism
 * exists to prevent, arriving through the mechanism itself.
 *
 * The claim is now the CREATE. `openSync(file, "wx")` fails with EEXIST when
 * the file already exists, and the filesystem decides that — so two processes
 * racing for one slot cannot both succeed, without a lock to acquire, hold or
 * leak. It is the same boundary-rather-than-a-look argument the repository's
 * `whole-file-writes` rule makes about `set -o noclobber`.
 */
export function claimSlot(dir, record, { maxSlots = MAX_SLOTS } = {}) {
  mkdirSync(dir, { recursive: true });
  for (let slot = 0; slot < maxSlots; slot += 1) {
    const file = join(dir, `${slot}.json`);
    const body = `${JSON.stringify({ slot, ...record, claimedAt: new Date().toISOString() }, null, 2)}\n`;

    // 🔴 `openSync(file, "wx")` creates the claim EMPTY and fills it after, so
    // between those two calls the file exists and parses as nothing. A
    // concurrent run reading it there saw an unowned slot. Writing a scratch
    // file first and LINKING it into place removes that window: `linkSync`
    // fails with EEXIST when the name is taken, and the name only ever appears
    // already complete.
    const scratch = join(dir, `.${slot}.${process.pid}.tmp`);
    writeFileSync(scratch, body);
    try {
      linkSync(scratch, file);
      return slot;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (isReclaimable(readClaim(file))) {
        // Another run may reclaim the same stale claim, so losing this race is
        // ordinary rather than exceptional: the slot is simply taken now.
        try {
          unlinkSync(file);
        } catch (unlinkError) {
          if (unlinkError.code !== "ENOENT") throw unlinkError;
        }
        slot -= 1; // retry this slot, which is free unless someone beat us
      }
    } finally {
      try {
        unlinkSync(scratch);
      } catch {
        // Linked into place, or never created.
      }
    }
  }
  throw new Error(`worktree: every slot below ${maxSlots} is claimed`);
}

/** Every claim on disk, newest field shape tolerated. */
export function readClaims(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith(".json"))
    .map(name => readClaim(join(dir, name)))
    .filter(claim => claim !== null)
    .sort((a, b) => a.slot - b.slot);
}

/** Whether a named container is up right now. */
function containerRunning(container) {
  try {
    const state = execFileSync("docker", ["inspect", "-f", "{{.State.Running}}", container], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return state === "true";
  } catch {
    // No such container, or no docker at all. Either way it is not running,
    // and that is a different fact from a command failing against one that is.
    return false;
  }
}

function sqlArgs(engine, container, statement) {
  return engine === "postgres"
    ? ["exec", container, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c", statement]
    : ["exec", container, "mysql", "-uroot", "-proot", "-e", statement];
}

/**
 * Create the slot's database in each running container.
 *
 * 🔴 The first version wrapped the whole thing in one catch that reported
 * every failure as "container not running", and `new` then succeeded anyway.
 * A permission error, a bad password or a full disk therefore left a checkout
 * whose `NEXTLY_TEST_DB` names a database that does not exist — and the
 * integration suites SELF-SKIP when they cannot connect, so the next run went
 * green having tested nothing. Two outcomes that need opposite responses were
 * rendered identically.
 *
 * Now the container is probed separately, so "not running" is established
 * rather than inferred from a failure, and a command that fails against a
 * container that IS running is an error the caller must see.
 */
export function provisionDatabases(
  slot,
  { run = execFileSync, willProvision = () => {}, isRunning = containerRunning } = {}
) {
  const name = databaseFor(slot);
  const results = [];
  for (const { container, engine } of TEST_DATABASES) {
    if (!isRunning(container)) {
      results.push({ container, state: "skipped", detail: "container not running" });
      continue;
    }
    // 🔴 Recorded BEFORE the container is touched, never after.
    //
    // Recording the OUTCOME meant an interrupted run left a record that was
    // short by whatever it had just done. A removal taken later, while that
    // container happened to be stopped, read the skip as "nothing was ever
    // created here", released the slot, and the next worktree inherited a
    // populated database.
    //
    // The record only has to be a SUPERSET of the containers holding the
    // database. Every drop is `IF EXISTS`, so naming one that never received
    // it costs a single statement, while missing one costs the isolation this
    // whole script exists for. Over-recording is the safe direction.
    willProvision(container);
    try {
      // IF NOT EXISTS is not portable to Postgres's CREATE DATABASE, so the
      // existence check is separate and the create is guarded by it.
      const exists = engine === "postgres"
        ? run("docker", ["exec", container, "psql", "-U", "postgres", "-tAc",
            `SELECT 1 FROM pg_database WHERE datname='${name}'`],
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
        : run("docker", ["exec", container, "mysql", "-uroot", "-proot", "-Nse",
            `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${name}'`],
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (exists) {
        results.push({ container, state: "present", detail: name });
        continue;
      }
      const create = engine === "postgres"
        ? `CREATE DATABASE ${name}`
        : `CREATE DATABASE \`${name}\``;
      run("docker", sqlArgs(engine, container, create), { stdio: ["ignore", "ignore", "pipe"] });
      results.push({ container, state: "created", detail: name });
    } catch (error) {
      // The container is up and the command still failed. That is a real
      // error, and reporting it as a skip is how a broken setup reads as a
      // working one.
      results.push({ container, state: "failed", detail: String(error.message ?? error).split("\n")[0] });
    }
  }
  return results;
}

/**
 * Drop the slot's databases.
 *
 * Slot 0's database is shared by the primary checkout and every unallocated
 * one, so it is never a removal's to drop. Returning null rather than guarding
 * at the call site keeps the decision in one place and testable.
 */
export function databaseToDrop(slot) {
  return slot === 0 ? null : databaseFor(slot);
}

export function dropDatabases(slot, { run = execFileSync } = {}) {
  const name = databaseToDrop(slot);
  if (name === null) {
    return [{ container: "(all)", state: "kept", detail: "slot 0 is the shared default" }];
  }
  const results = [];
  for (const { container, engine } of TEST_DATABASES) {
    if (!containerRunning(container)) {
      results.push({ container, state: "skipped", detail: "container not running" });
      continue;
    }
    try {
      const drop = engine === "postgres"
        ? `DROP DATABASE IF EXISTS ${name}`
        : `DROP DATABASE IF EXISTS \`${name}\``;
      run("docker", sqlArgs(engine, container, drop), { stdio: ["ignore", "ignore", "pipe"] });
      results.push({ container, state: "dropped", detail: name });
    } catch (error) {
      // Postgres refuses to drop a database with a live connection, which is
      // the ordinary case when a test run is still finishing. Treating that as
      // done is what let a later worktree inherit a populated database.
      results.push({ container, state: "failed", detail: String(error.message ?? error).split("\n")[0] });
    }
  }
  return results;
}

/**
 * Whether a teardown left anything behind.
 *
 * Both a failure and a skip mean the database still exists: one because the
 * drop was refused, the other because nothing was asked. The slot must stay
 * reserved in either case, so they answer the same question here even though
 * they print differently.
 */
export function teardownIncomplete(results, provisioned = null) {
  return results.some(result => {
    if (result.state === "failed") return true;
    if (result.state !== "skipped") return false;
    // A container that never received this slot's database has nothing to
    // drop, so skipping it leaves nothing behind. Without this every removal
    // taken while the containers are down reserved its slot forever, and
    // clearing it meant starting every container to drop databases that were
    // never created — friction with no safety behind it.
    //
    // `null` means the claim predates this record, and then a skip is
    // unaccounted for and the slot is held. Unknown is not empty.
    if (provisioned === null) return true;
    return provisioned.includes(result.container);
  });
}

/** Merge the slot's env into a checkout's local settings, keeping the rest. */
export function settingsWithEnv(existing, env) {
  const current = existing ?? {};
  return { ...current, env: { ...(current.env ?? {}), ...env } };
}

function writeSettings(path, env) {
  const dir = join(path, ".claude");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "settings.local.json");
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  writeFileSync(file, `${JSON.stringify(settingsWithEnv(existing, env), null, 2)}\n`);
  return file;
}

function commonDir() {
  return resolve(root, git(["rev-parse", "--git-common-dir"]));
}

/** The primary checkout holds slot 0, whether or not anything recorded it. */
function ensurePrimaryClaim(dir) {
  const file = join(dir, "0.json");
  if (existsSync(file)) return;
  mkdirSync(dir, { recursive: true });
  // 🔴 git is asked BEFORE the claim exists. Creating the file first and then
  // shelling out left an empty `0.json` whenever that call threw: `existsSync`
  // short-circuits every later call, the empty file parses as nothing, and the
  // next `worktree new` took slot 0 — the primary checkout's ports and its
  // shared `nextly_test` database, which is the collision this module exists
  // to prevent.
  const primary = worktreeRecords(git(["worktree", "list", "--porcelain"]))[0];
  const body = `${JSON.stringify({ slot: 0, path: primary?.path ?? root, branch: primary?.branch ?? null, primary: true }, null, 2)}\n`;
  const scratch = join(dir, `.0.${process.pid}.primary.tmp`);
  writeFileSync(scratch, body);
  try {
    linkSync(scratch, file);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  } finally {
    try {
      unlinkSync(scratch);
    } catch {
      // Linked into place, or never created.
    }
  }
}

/** Merge the list of containers holding this slot's database into its claim. */
export function recordProvisioned(dir, slot, containers) {
  const file = join(dir, `${slot}.json`);
  let claim;
  try {
    claim = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return; // No readable claim to annotate.
  }
  const merged = [...new Set([...(claim.provisioned ?? []), ...containers])];
  writeFileSync(file, `${JSON.stringify({ ...claim, provisioned: merged }, null, 2)}\n`);
}

function report(results, indent = "    ") {
  for (const { container, state, detail } of results) {
    console.log(`${indent}${container}: ${state}${detail ? ` — ${detail}` : ""}`);
  }
}

function commandNew(branch, from, worktreeRoot) {
  const dir = claimDir(commonDir());
  ensurePrimaryClaim(dir);

  const target = join(worktreeRoot, `${basename(root)}-${branch.split("/").join("-")}`);
  if (existsSync(target)) {
    console.error(`worktree: ${target} already exists — refusing to write into it`);
    process.exit(2);
  }

  // Claimed BEFORE the checkout is created, so a concurrent run cannot take
  // the same number in the window between choosing and recording it.
  const slot = claimSlot(dir, { path: target, branch });

  try {
    git(["worktree", "add", "-b", branch, target, from]);
  } catch (error) {
    // The claim describes a checkout that was never created, so release it
    // rather than leaking the slot.
    try {
      unlinkSync(join(dir, `${slot}.json`));
    } catch {
      // Already gone is the outcome we wanted.
    }
    throw error;
  }

  const env = slotEnv(slot);
  const settings = writeSettings(target, env);
  // The record is written per container as provisioning reaches it, so an
  // interrupted run leaves a record that is never short of what exists.
  const provisioned = provisionDatabases(slot, {
    willProvision: container => recordProvisioned(dir, slot, [container]),
  });
  const failed = provisioned.filter(result => result.state === "failed");

  console.log(`worktree: ${target}`);
  console.log(`  branch ${branch} from ${from}, slot ${slot}`);
  console.log(`  ports ${PORT_NAMES.map(name => `${name}=${env[name]}`).join(" ")}`);
  console.log(`  test database ${databaseFor(slot)}`);
  report(provisioned);
  console.log(`  ${settings} carries the env, so Claude Code sessions there pick it up`);

  if (failed.length > 0) {
    console.error(
      `\nworktree: ${failed.length} database(s) could not be created against a RUNNING container.`
    );
    console.error("  The checkout exists but its integration lanes would self-skip, which reads");
    console.error("  as a pass. Fix the cause and run `pnpm worktree provision` in that checkout.");
    process.exit(1);
  }
  if (provisioned.some(result => result.state === "skipped")) {
    console.log("\n  Some containers are down, so their databases do not exist yet.");
    console.log("  After `docker start ...`, run `pnpm worktree provision` in that checkout.");
  }
}

function commandRemove(target, { keepBranch, force }) {
  const records = worktreeRecords(git(["worktree", "list", "--porcelain"]));
  const match = findWorktree(records, target);

  if (!match) {
    console.error(`worktree: no checkout matches '${target}' by branch or path.`);
    console.error("  `pnpm worktree list` shows them. Removal matches exactly, never by prefix.");
    process.exit(2);
  }
  if (resolve(match.path) === root) {
    console.error("worktree: refusing to remove the checkout this command is running in");
    process.exit(2);
  }

  const dir = claimDir(commonDir());
  const claims = readClaims(dir);
  const claim = claims.find(entry => resolve(entry.path) === resolve(match.path));
  const slot = claim?.slot ?? 0;

  const file = claim ? join(dir, `${slot}.json`) : null;

  // 🔴 The databases used to be dropped FIRST, so a checkout git then refused
  // to remove — a dirty one, which is exactly the case the non-force default
  // exists to protect — kept its files while every running container lost its
  // database. A routine cleanup partially destroyed the environment it was
  // meant to preserve.
  //
  // Git goes first now. The slot cannot be reissued in the meantime because
  // the claim is marked BEFORE the checkout disappears: `isReclaimable`
  // refuses a claim carrying `pendingCleanup`, so the window where the path is
  // gone but the claim is not yet resolved is not a window anyone can take.
  if (file) {
    writeFileSync(file, `${JSON.stringify({ ...claim, pendingCleanup: true }, null, 2)}\n`);
  }

  const removeArgs = ["worktree", "remove", match.path];
  if (force) removeArgs.splice(2, 0, "--force");
  try {
    git(removeArgs);
  } catch (error) {
    // `--force` used to be unconditional, which discards uncommitted work from
    // a routine cleanup command. Refusing is the safe default; the message
    // says how to proceed once the work is dealt with. Nothing has been
    // dropped at this point, so the checkout is exactly as it was.
    if (file) {
      writeFileSync(file, `${JSON.stringify(claim, null, 2)}\n`);
    }
    console.error(`worktree: refusing to remove ${match.path}`);
    console.error(`  ${String(error.message ?? error).split("\n").filter(Boolean).slice(-1)[0]}`);
    console.error("  Commit or stash the work, or pass --force to discard it.");
    console.error("  Its databases are untouched.");
    process.exit(1);
  }

  const dropped = dropDatabases(slot);
  const incomplete = teardownIncomplete(dropped, claim?.provisioned ?? null) && slot !== 0;

  let branchState = "kept";
  if (!keepBranch && match.branch) {
    // `-d` refuses an unmerged branch; `-D` deletes it regardless. The first
    // version used `-D` while its comment claimed git would decline, so a
    // routine cleanup silently destroyed unpushed commits.
    try {
      git(["branch", force ? "-D" : "-d", match.branch]);
      branchState = force ? "force-deleted" : "deleted";
    } catch {
      branchState = "kept (unmerged — delete it yourself, or re-run with --force)";
    }
  }

  console.log(`worktree: removed ${match.path}`);
  report(dropped);
  console.log(`  branch ${match.branch ?? "(detached)"}: ${branchState}`);

  if (!file) {
    console.log(`  no slot claim recorded for this checkout; nothing to release`);
    return;
  }
  if (incomplete) {
    // Retain the reservation. Releasing a slot whose database still exists is
    // how the next checkout inherits another run's tables.
    writeFileSync(file, `${JSON.stringify({ ...claim, pendingCleanup: true, path: match.path }, null, 2)}\n`);
    console.log(`  slot ${slot} RESERVED, not released — its databases still exist`);
    console.log("  start the test containers and run `pnpm worktree sweep` to release it");
  } else {
    try {
      unlinkSync(file);
    } catch {
      // Already gone is the outcome we wanted.
    }
    console.log(`  slot ${slot} released`);
  }
}

/** Retry database creation for the checkout this runs in. */
function commandProvision() {
  const env = existsSync(join(root, ".claude", "settings.local.json"))
    ? JSON.parse(readFileSync(join(root, ".claude", "settings.local.json"), "utf8")).env ?? {}
    : {};
  // The same unvalidated conversion `worktree env` carried: a hand-edited
  // settings file with a nonsense slot provisioned `nextly_test_wNaN` and
  // reported success.
  const slot = parseSlot(String(env.NEXTLY_WORKTREE_SLOT ?? 0));
  if (slot === null) {
    console.error(
      `worktree: .claude/settings.local.json sets NEXTLY_WORKTREE_SLOT=` +
        `${env.NEXTLY_WORKTREE_SLOT}, which is not a slot from 0 to ${MAX_SLOTS - 1}`
    );
    process.exit(2);
  }
  const dir = claimDir(commonDir());
  const results = provisionDatabases(slot, {
    willProvision: container => recordProvisioned(dir, slot, [container]),
  });
  console.log(`worktree: provisioning slot ${slot} (${databaseFor(slot)})`);
  report(results, "  ");
  const failed = results.filter(result => result.state === "failed");
  const skipped = results.filter(result => result.state === "skipped");
  if (failed.length > 0) process.exit(1);
  if (skipped.length > 0) {
    // Every container `provisionDatabases` checks, so following this and
    // retrying actually clears the skip. Naming a subset left postgres15
    // skipped and the retry exited 1 again with no new information.
    console.log(
      `\n  Start the containers first: docker start ${TEST_DATABASES.map(entry => entry.container).join(" ")}`
    );
    process.exit(1);
  }
}

/** Release slots whose databases could not be dropped at removal time. */
function commandSweep() {
  const dir = claimDir(commonDir());
  const pending = readClaims(dir).filter(claim => claim.pendingCleanup);
  if (pending.length === 0) {
    console.log("worktree: no slot is waiting on database cleanup");
    return;
  }
  let stuck = 0;
  for (const claim of pending) {
    const results = dropDatabases(claim.slot);
    console.log(`slot ${claim.slot} (${databaseFor(claim.slot)}):`);
    report(results, "  ");
    if (teardownIncomplete(results, claim.provisioned ?? null)) {
      stuck += 1;
      console.log(`  still reserved`);
      continue;
    }
    try {
      unlinkSync(join(dir, `${claim.slot}.json`));
    } catch {
      // Already gone is the outcome we wanted.
    }
    console.log(`  released`);
  }
  if (stuck > 0) process.exit(1);
}

function commandList() {
  const records = worktreeRecords(git(["worktree", "list", "--porcelain"]));
  const dir = claimDir(commonDir());
  const claims = readClaims(dir);
  for (const record of records) {
    const claim = claims.find(entry => resolve(entry.path) === resolve(record.path));
    const slot = claim?.slot ?? 0;
    const env = slotEnv(slot);
    console.log(
      `slot ${String(slot).padEnd(3)} ${PORT_NAMES.map(n => env[n]).join("/")}  ` +
        `${databaseFor(slot).padEnd(18)} ${record.branch ?? "(detached)"}  ${record.path}`
    );
  }
  for (const claim of claims.filter(c => c.pendingCleanup)) {
    console.log(`slot ${String(claim.slot).padEnd(3)} RESERVED — databases from ${claim.path} were never dropped`);
  }
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flag = name => {
    const at = rest.indexOf(`--${name}`);
    return at === -1 ? null : rest[at + 1];
  };

  if (command === "new") {
    const branch = rest[0];
    if (!branch || branch.startsWith("--")) {
      console.error("worktree: new <branch> [--from <ref>] [--root <dir>]");
      process.exit(2);
    }
    return commandNew(branch, flag("from") ?? "origin/main", resolve(flag("root") ?? join(root, "..")));
  }
  if (command === "remove") {
    const target = rest[0];
    if (!target || target.startsWith("--")) {
      console.error("worktree: remove <branch|path> [--keep-branch] [--force]");
      process.exit(2);
    }
    return commandRemove(target, {
      keepBranch: rest.includes("--keep-branch"),
      force: rest.includes("--force"),
    });
  }
  if (command === "list") return commandList();
  if (command === "provision") return commandProvision();
  if (command === "sweep") return commandSweep();
  if (command === "env") {
    // `flag` returns null when the option is absent and undefined when it is
    // present with nothing after it, and those mean different things here: no
    // `--slot` is the primary checkout, a `--slot` with no value is a typo.
    const raw = flag("slot");
    const slot = raw === null ? 0 : parseSlot(raw);
    if (slot === null) {
      console.error(`worktree: --slot needs an integer from 0 to ${MAX_SLOTS - 1}`);
      process.exit(2);
    }
    const env = slotEnv(slot);
    for (const [key, value] of Object.entries(env)) console.log(`export ${key}=${value}`);
    return;
  }
  console.error("worktree: new | list | remove | provision | sweep | env");
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith("worktree.mjs")) {
  main();
}
