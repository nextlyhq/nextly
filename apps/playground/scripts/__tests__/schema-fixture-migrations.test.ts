/**
 * The schema fixture's shipped migration modules, held to the generator and
 * to a real `nextly migrate`.
 *
 * Modules written by hand can describe one schema in their SQL and another in
 * their snapshots, and nothing reading them one at a time notices: the runner
 * judges each module against the snapshot it carries, so a fresh database the
 * SQL built was refused by the next module. Two properties close that:
 *
 * - `migrate:create --plugin` finds nothing to generate, so the newest
 *   snapshot is the plugin's schema as the generator compiles it today;
 * - `nextly migrate` on a brand-new database applies every module, and the
 *   tables it leaves are the newest snapshot's, so each module's SQL reaches
 *   the snapshot it claims.
 *
 * Both run the CLI the way a contributor does, against a throwaway SQLite
 * file, because the failure was in the command and not in any one function.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrations } from "../../src/plugins/schema-fixture/migrations";

const PLAYGROUND = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = resolve(PLAYGROUND, "node_modules/nextly/dist/cli/nextly.mjs");

let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "nextly-schema-fixture-"));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Run the nextly CLI in the playground with the fixture registered. */
function nextly(database: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: PLAYGROUND,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "development",
      NEXTLY_SCHEMA_FIXTURE: "1",
      DB_DIALECT: "sqlite",
      DATABASE_URL: `file:${database}`,
      NEXTLY_SECRET: "schema-fixture-test-secret-not-for-production-32chars",
    },
  });
  return {
    status: result.status,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

describe("the schema fixture's migration modules", () => {
  it("are what the generator emits for the plugin today", () => {
    const run = nextly(
      join(scratch, "generate.db"),
      "migrate:create",
      "--plugin",
      "src/plugins/schema-fixture/plugin.ts",
      "current"
    );
    // Exit 2 is the "no changes detected" contract.
    expect(run.output).toMatch(/No schema changes detected/);
    expect(run.status).toBe(2);
  }, 120_000);

  it("migrate a brand-new database to the newest module's snapshot", () => {
    const database = join(scratch, "fresh.db");
    const run = nextly(database, "migrate");
    expect(run.output).toMatch(/Plugin migrations: 2 applied/);
    // The summary counts the plugin modules it just ran.
    expect(run.output).toMatch(/2 migrations applied\./);
    expect(run.output).not.toMatch(/Nothing to migrate/);
    expect(run.status).toBe(0);

    const newest = migrations[migrations.length - 1];
    const sqlite = new Database(database, { readonly: true });
    try {
      for (const table of newest.snapshot.sqlite.tables) {
        const live = sqlite
          .prepare(`PRAGMA table_info("${table.name}")`)
          .all() as Array<{ name: string }>;
        expect(live.map(column => column.name).sort()).toEqual(
          table.columns.map(column => column.name).sort()
        );
      }
    } finally {
      sqlite.close();
    }
  }, 120_000);
});
