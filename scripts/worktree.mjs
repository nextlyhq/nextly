#!/usr/bin/env node

/**
 * Give each worktree its own ports and its own test databases.
 *
 * Several agents working at once need several checkouts, and this repository
 * has three things that are shared rather than per-checkout. Two are obvious
 * once stated: the playground binds :3000 and the Playwright suite binds :3100,
 * so a second worktree running either collides on a port.
 *
 * 🔴 The third is not obvious and fails silently. Integration suites give
 * TEST-OWNED tables a random per-file prefix, which makes files independent —
 * but Nextly's SYSTEM tables have fixed names (`nextly_schema_events` and its
 * neighbours) and cannot be prefixed. Inside one run that is handled by
 * `fileParallelism: false`. Across two worktrees it is not handled at all:
 * both point `TEST_POSTGRES_URL` at `nextly_test` on the same container, and
 * the second run drops and recreates a system table the first is still using.
 * The result reads as a flaky test rather than as a collision, which is the
 * expensive way to find it.
 *
 * So the isolation has to be a separate DATABASE per worktree rather than a
 * prefix. The containers stay shared — they are addressed by fixed
 * `container_name`, so exactly one compose project can own them and a second
 * worktree bringing up its own would fail on the taken names.
 *
 * Slot 0 is the defaults, so an existing checkout that never runs this behaves
 * exactly as before.
 *
 * Usage:
 *   node scripts/worktree.mjs new <branch> [--from <ref>] [--root <dir>]
 *   node scripts/worktree.mjs list
 *   node scripts/worktree.mjs env [--slot <n>]
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Ports and databases are derived from one number, never picked twice. */
export const BASE = {
  playground: 3000,
  e2e: 3100,
  stride: 10,
  database: "nextly_test",
};

/** The test containers a worktree needs a database inside. */
export const TEST_DATABASES = [
  { container: "nextly-postgres17-test", engine: "postgres", port: 5435 },
  { container: "nextly-postgres15-test", engine: "postgres", port: 5434 },
  { container: "nextly-mysql-test", engine: "mysql", port: 3307 },
];

/** The database name a slot owns. */
export function databaseFor(slot) {
  return slot === 0 ? BASE.database : `${BASE.database}_w${slot}`;
}

/**
 * Everything a slot decides.
 *
 * Slot 0 returns the documented defaults verbatim, which is what makes this
 * safe to land: a checkout that never allocates a slot is unchanged.
 */
export function slotEnv(slot) {
  return {
    NEXTLY_WORKTREE_SLOT: String(slot),
    // The DATABASE, not a URL. Each dialect leg keeps its own port — postgres15
    // is on 5434 and postgres17 on 5435 — so a single TEST_POSTGRES_URL in the
    // environment would silently point the `:postgres15` leg at the 17
    // container and report a pass for a version it never ran against.
    NEXTLY_TEST_DB: databaseFor(slot),
    PORT: String(BASE.playground + slot * BASE.stride),
    E2E_PORT: String(BASE.e2e + slot * BASE.stride),
  };
}

function git(args, cwd = root) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** Every checkout of this clone, as absolute paths. */
export function worktreePaths(porcelain) {
  return porcelain
    .split("\n")
    .filter(line => line.startsWith("worktree "))
    .map(line => line.slice("worktree ".length));
}

/**
 * The slot a checkout has already been given.
 *
 * 🔴 An unallocated checkout holds slot 0, and returning null for it is how the
 * first run of this command handed a new worktree slot 0 as well — the main
 * checkout's :3000 and its `nextly_test` database, which is the collision the
 * whole slot mechanism exists to stop. Absence of a claim is not absence of an
 * occupant: every checkout occupies something, and the default is what it
 * occupies.
 */
export function slotOf(path) {
  const settings = join(path, ".claude", "settings.local.json");
  if (!existsSync(settings)) return 0;
  try {
    const value = JSON.parse(readFileSync(settings, "utf8"))?.env?.NEXTLY_WORKTREE_SLOT;
    return value === undefined ? 0 : Number(value);
  } catch {
    // A settings file this cannot parse still belongs to a checkout that is
    // using the defaults, so it holds slot 0 like any other unallocated one.
    // Refusing here would let an unrelated syntax error block the command.
    return 0;
  }
}

/**
 * The lowest slot nobody holds.
 *
 * Lowest-free rather than next-highest, so removing a worktree returns its
 * ports and its databases to the pool instead of leaking them upward.
 */
export function lowestFreeSlot(taken) {
  // REFUSES a non-integer rather than filtering it out. Filtering is what the
  // first version did, and it is why a checkout reporting `null` was read as
  // no occupant at all and slot 0 was handed out twice. Dropping an entry you
  // cannot read turns "I do not know what this checkout holds" into "it holds
  // nothing", which is the answer that causes the collision.
  for (const value of taken) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`worktree: cannot read the slot of every checkout (got ${value})`);
    }
  }
  const held = new Set(taken);
  let slot = 0;
  while (held.has(slot)) slot += 1;
  return slot;
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

/**
 * Create the slot's database inside each running test container.
 *
 * Advisory: a container that is not up is reported and skipped rather than
 * failing the command, because creating the worktree is still the right
 * outcome and the databases can be made later. What it must never do is report
 * success without having created anything, so each container says which it was.
 */
function createDatabases(slot) {
  const name = databaseFor(slot);
  const results = [];
  for (const { container, engine } of TEST_DATABASES) {
    try {
      execFileSync("docker", ["inspect", "-f", "{{.State.Running}}", container], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() === "true" || (() => {
        throw new Error("not running");
      })();

      const argv =
        engine === "postgres"
          ? ["exec", container, "psql", "-U", "postgres", "-tAc",
             `SELECT 1 FROM pg_database WHERE datname='${name}'`]
          : ["exec", container, "mysql", "-uroot", "-proot", "-Nse",
             `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${name}'`];
      const exists = execFileSync("docker", argv, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();

      if (exists) {
        results.push({ container, state: "already present" });
        continue;
      }
      const create =
        engine === "postgres"
          ? ["exec", container, "psql", "-U", "postgres", "-c", `CREATE DATABASE ${name}`]
          : ["exec", container, "mysql", "-uroot", "-proot", "-e",
             `CREATE DATABASE \`${name}\``];
      execFileSync("docker", create, { stdio: ["ignore", "ignore", "pipe"] });
      results.push({ container, state: "created" });
    } catch {
      results.push({ container, state: "SKIPPED — container not running" });
    }
  }
  return results;
}

function commandNew(branch, from, worktreeRoot) {
  const porcelain = git(["worktree", "list", "--porcelain"]);
  const paths = worktreePaths(porcelain);
  const slot = lowestFreeSlot(paths.map(slotOf));
  const target = join(worktreeRoot, `${basename(root)}-${branch.replace(/\//g, "-")}`);

  if (existsSync(target)) {
    console.error(`worktree: ${target} already exists — refusing to write into it`);
    process.exit(2);
  }

  git(["worktree", "add", "-b", branch, target, from]);
  const env = slotEnv(slot);
  const settings = writeSettings(target, env);

  console.log(`worktree: ${target}`);
  console.log(`  branch ${branch} from ${from}, slot ${slot}`);
  console.log(`  playground :${env.PORT}   e2e :${env.E2E_PORT}`);
  console.log(`  test database ${databaseFor(slot)}`);
  for (const { container, state } of createDatabases(slot)) {
    console.log(`    ${container}: ${state}`);
  }
  console.log(`  ${settings} carries the env, so Claude Code sessions there pick it up`);
  console.log(`\n  for a plain shell in that worktree:`);
  for (const [key, value] of Object.entries(env)) console.log(`    export ${key}=${value}`);
}

function commandList() {
  const paths = worktreePaths(git(["worktree", "list", "--porcelain"]));
  for (const path of paths) {
    const slot = slotOf(path);
    const env = slotEnv(slot);
    console.log(`slot ${String(slot).padEnd(4)} :${env.PORT}/:${env.E2E_PORT}  ${databaseFor(slot).padEnd(18)} ${path}`);
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
    commandNew(branch, flag("from") ?? "origin/main", resolve(flag("root") ?? join(root, "..")));
    return;
  }
  if (command === "list") return commandList();
  if (command === "env") {
    const env = slotEnv(Number(flag("slot") ?? 0));
    for (const [key, value] of Object.entries(env)) console.log(`export ${key}=${value}`);
    return;
  }
  console.error("worktree: new | list | env");
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith("worktree.mjs")) {
  main();
}
