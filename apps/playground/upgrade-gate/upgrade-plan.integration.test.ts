/**
 * The upgrade gate: an install built by an earlier, published Nextly release,
 * upgraded to this checkout the way a deployed site upgrades, plans exactly
 * the operations `allowlist.ts` holds, and no others.
 *
 * The install is this playground as the release in `baseline/meta.json` built
 * it on each dialect: its database, schema and rows, and the app migrations
 * that release's `nextly migrate:create` wrote (see `record.ts`). The test
 * restores it into a database of its own, and then does what a site's
 * developer and deployment do after bumping the version:
 *
 * 1. `nextly migrate:create`, which writes a migration for whatever this
 *    release now derives differently from the same collections, Singles and
 *    components (a declared index, a column type), as `migrate:check` would
 *    report it in the site's CI. Where it moves a column's values (into a
 *    translations table) and drops the column, it asks consent; with no
 *    terminal, `--accept-data-loss` names exactly the columns the upgrade
 *    is judged to move (`UPGRADE_CONSENT`), so a deletion beyond them refuses;
 * 2. `nextly migrate --backup-confirmed`, which reconciles the core tables,
 *    applies that migration and any plugin module, and brings stored data up
 *    to date, asking the same consent again for this database;
 * 3. `nextly migrate:status`, which must then find nothing pending, failed or
 *    unfinished in the database, and `nextly migrate:check`, which must find
 *    the migrations whole and the configuration recorded.
 *
 * Before the first step the install is given content (`values.ts`): one entry
 * in each content table, a distinct value in every free-text column. After the
 * upgrade every one of those values must still be where Nextly keeps it, so an
 * upgrade that moved values wrongly, or dropped them, fails here.
 *
 * The operations planned are read from the database itself: its catalog before
 * and after, compared element by element (`catalog.ts`). So whatever the
 * upgrade changes is seen, from whichever step it comes. The playground's own
 * configuration moves with this checkout, so an entity changed here since the
 * release is in the plan too, and is allowlisted the same way until the next
 * baseline.
 *
 * Which dialects run: PostgreSQL when TEST_POSTGRES_URL is set, MySQL when
 * TEST_MYSQL_URL is set, and SQLite, on a file, when neither is, as the
 * integration legs divide them.
 */
import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ALLOWED_OPERATIONS, UPGRADE_CONSENT } from "./allowlist";
import {
  judge,
  operationsBetween,
  verdictMessage,
  type Catalog,
  type Dialect,
} from "./catalog";
import {
  makeScratchDatabase,
  readCatalog,
  restore,
  type ScratchDatabase,
} from "./database";
import { BASELINE_DIR, siteEnvironment, type BaselineMeta } from "./record";
import { lostValues, seedContent, type SeededValue } from "./values";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const playground = resolve(here, "..");

const meta = JSON.parse(
  readFileSync(join(BASELINE_DIR, "meta.json"), "utf8")
) as BaselineMeta;

/** The dialects this run has a database for; see the file's header. */
function dialects(): Dialect[] {
  const servers: Dialect[] = [];
  if (process.env.TEST_POSTGRES_URL) servers.push("postgresql");
  if (process.env.TEST_MYSQL_URL) servers.push("mysql");
  return servers.length > 0 ? servers : ["sqlite"];
}

/** What a command ended with, failure included. */
interface Outcome {
  code: number;
  output: string;
}

describe.each(dialects())(
  `upgrading the playground from ${meta.release} on %s`,
  dialect => {
    let scratch: string;
    let database: ScratchDatabase;
    let before: Catalog;
    let environment: NodeJS.ProcessEnv;
    let seeded: SeededValue[];

    beforeAll(async () => {
      scratch = mkdtempSync(join(tmpdir(), "upgrade-gate-"));
      database = await makeScratchDatabase(
        dialect,
        {
          server:
            dialect === "postgresql"
              ? process.env.TEST_POSTGRES_URL
              : process.env.TEST_MYSQL_URL,
          file: join(scratch, "site.sqlite"),
        },
        "_upgrade_gate"
      );
      await restore(
        dialect,
        database.url,
        readFileSync(join(BASELINE_DIR, dialect, "database.sql"), "utf8")
      );
      // The migrations the release wrote, where the playground's config keeps
      // a site's migrations, relative to the command's directory.
      cpSync(
        join(BASELINE_DIR, dialect, "migrations"),
        join(scratch, "src/db/migrations"),
        { recursive: true }
      );
      before = await readCatalog(dialect, database.url);
      seeded = await seedContent(dialect, database.url, before);
      // The playground as the recorder ran it (`siteEnvironment`).
      environment = siteEnvironment(process.env, {
        databaseUrl: database.url,
        playgroundPlugins: meta.playgroundPlugins,
      });
    });

    afterAll(async () => {
      await database?.drop();
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    });

    /** This checkout's `nextly`, on the playground's config, in the scratch site. */
    const nextly = (...args: string[]): Promise<Outcome> =>
      run(
        join(playground, "node_modules/.bin/nextly"),
        [...args, "--config", join(playground, "nextly.config.ts")],
        {
          cwd: scratch,
          env: environment,
          timeout: 170_000,
          maxBuffer: 64 * 1024 * 1024,
        }
      ).then(
        ({ stdout, stderr }) => ({ code: 0, output: `${stdout}\n${stderr}` }),
        (error: { code?: number; stdout?: string; stderr?: string }) => ({
          code: typeof error.code === "number" ? error.code : -1,
          output: `${error.stdout ?? ""}\n${error.stderr ?? ""}`,
        })
      );

    it("restores the release's install", () => {
      // The core tables the release made, so the steps below meet a real
      // install rather than an empty database they would build from nothing.
      expect(Object.keys(before)).toEqual(
        expect.arrayContaining(["users", "user_roles", "nextly_schema_events"])
      );
    });

    it("migrate:create writes the upgrade's migration for the unchanged config", async () => {
      const outcome = await nextly(
        "migrate:create",
        "--name",
        "upgrade",
        "--non-interactive",
        `--accept-data-loss=${UPGRADE_CONSENT.join(",")}`
      );
      expect(outcome.code, outcome.output).toBe(0);
    });

    it("migrate applies the upgrade", async () => {
      const outcome = await nextly(
        "migrate",
        "--backup-confirmed",
        `--accept-data-loss=${UPGRADE_CONSENT.join(",")}`
      );
      expect(outcome.code, outcome.output).toBe(0);
    });

    it("plans exactly the allowlisted operations", async () => {
      const planned = operationsBetween(
        before,
        await readCatalog(dialect, database.url)
      );
      const verdict = judge(planned, ALLOWED_OPERATIONS, dialect);
      expect(
        verdict,
        verdictMessage(verdict, dialect, `nextly ${meta.release}`)
      ).toEqual({ unexpected: [], stale: [] });
    });

    it("keeps every value the install held", async () => {
      // The control: the install was given values to keep.
      expect(seeded.length).toBeGreaterThan(0);
      expect(await lostValues(dialect, database.url, seeded)).toEqual([]);
    });

    it("leaves migrate:status nothing pending, failed or unfinished", async () => {
      // `migrate:check` reads the migration files and the configuration;
      // this reads the database the upgrade ran on.
      const outcome = await nextly("migrate:status", "--json");
      expect(outcome.code, outcome.output).toBe(0);
      for (const count of ["pending", "failed", "unfinished"]) {
        expect(outcome.output, outcome.output).toMatch(
          new RegExp(`"${count}":\\s*0\\b`)
        );
      }
      // The control: the summary is there, so the matches above read it.
      expect(outcome.output).toMatch(/"applied":\s*[1-9]/);
    });

    it("leaves migrate:check nothing to report", async () => {
      const outcome = await nextly("migrate:check");
      expect(outcome.code, outcome.output).toBe(0);
    });
  }
);
