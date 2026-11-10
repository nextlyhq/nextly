/**
 * `migrate:fresh` drops every table, so only the data-loss consent lets it:
 * `--yes` answers questions and never consents to deleting data. Run as a
 * shell runs it, with no terminal to ask, `migrate:fresh --yes` leaves every
 * table in place, exits 1 and names the consent that would allow it, and `migrate:fresh --accept-data-loss` drops
 * them and rebuilds the migrated ones, on every configured dialect.
 *
 * A table no migration creates is the observable that separates a rebuild
 * from a run that did nothing: a fresh run drops it and does not bring it
 * back, while the migrated tables return.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";

/** This file's own collection and stray table, so its tables are its own. */
const COLLECTION = "mfc_posts";
const STRAY = "mfc_stray";

const CONFIG = `
export default {
  collections: [{ slug: "${COLLECTION}", fields: [{ name: "title", type: "text" }] }],
  db: { migrationsDir: "./migrations" },
};
`;

describe.each(getConfiguredTestDialects())(
  "migrate:fresh and the data-loss consent (%s)",
  (dialect: TestDialect) => {
    let project: string;
    let instance: TestNextly | undefined;
    let databaseUrl: string | undefined;
    let databaseDialect: string | undefined;

    beforeEach(async () => {
      project = mkdtempSync(join(tmpdir(), "nextly-fresh-consent-"));
      writeFileSync(join(project, "nextly.config.ts"), CONFIG);
      databaseUrl = process.env.DATABASE_URL;
      databaseDialect = process.env.DB_DIALECT;
      if (dialect === "sqlite") {
        // A file the commands' own connections open, which in-memory is not.
        const url = `file:${join(project, "test.db")}`;
        process.env.DB_DIALECT = "sqlite";
        process.env.DATABASE_URL = url;
        _resetEnvCache();
        instance = await createTestNextly({
          adapter: await createAdapter({ type: "sqlite", url } as Parameters<
            typeof createAdapter
          >[0]),
        });
      } else {
        // Points DATABASE_URL at a database of its own for this test.
        instance = await createTestNextly({ dialect });
      }
    });

    afterEach(async () => {
      await instance?.destroy();
      instance = undefined;
      if (databaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = databaseUrl;
      if (databaseDialect === undefined) delete process.env.DB_DIALECT;
      else process.env.DB_DIALECT = databaseDialect;
      _resetEnvCache();
      rmSync(project, { recursive: true, force: true });
    });

    /**
     * `nextly <args>` in the project against the database this test booted,
     * with no consent in the environment. Its standard input is a pipe, never
     * a terminal, so nothing can be asked.
     */
    const nextly = (args: string[]) =>
      runNextly(args, project, {
        NODE_ENV: undefined,
        NEXTLY_ACCEPT_DATA_LOSS: undefined,
        NEXTLY_SECRET: randomBytes(32).toString("hex"),
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      });

    /** The project migrated, with a table beside it that no migration creates. */
    async function migratedWithStray(): Promise<string[]> {
      for (const command of [["migrate:create", "init"], ["migrate"]]) {
        const run = await nextly([...command, "--quiet"]);
        expect(run.status, run.stderr).toBe(0);
      }
      await instance!.adapter.executeQuery(
        `CREATE TABLE ${STRAY} (id integer)`
      );
      const tables = (await instance!.adapter.listTables()).sort();
      expect(tables).toContain(`dc_${COLLECTION}`);
      expect(tables).toContain(STRAY);
      return tables;
    }

    it(
      "--yes alone with no terminal leaves every table, naming --accept-data-loss",
      async () => {
        const before = await migratedWithStray();
        const run = await nextly(["migrate:fresh", "--yes"]);
        expect(run.status, run.stdout + run.stderr).toBe(1);
        expect(run.stdout + run.stderr).toContain(
          "--yes does not consent to deleting data: give --accept-data-loss"
        );
        expect((await instance!.adapter.listTables()).sort()).toEqual(before);
      },
      3 * NEXTLY_RUN_TIMEOUT
    );

    it(
      "--dry-run names every table it would drop and each migration it would re-run, and drops none",
      async () => {
        const before = await migratedWithStray();
        // No consent given: a dry run deletes nothing, so it needs none.
        const run = await nextly(["migrate:fresh", "--dry-run"]);
        expect(run.status, run.stdout + run.stderr).toBe(0);
        expect(run.stdout).toContain(`Would remove table ${STRAY}`);
        expect(run.stdout).toContain(`Would remove table dc_${COLLECTION}`);
        expect(run.stdout).toMatch(/Would run migration \S+_init/);
        expect(run.stdout).toContain("Dry run: nothing was changed.");
        expect((await instance!.adapter.listTables()).sort()).toEqual(before);

        // With --seed, the step a real MySQL run takes before the seeders.
        const seeded = await nextly(["migrate:fresh", "--dry-run", "--seed"]);
        expect(seeded.status, seeded.stdout + seeded.stderr).toBe(0);
        expect(seeded.stdout.includes("MySQL schema reconciliation")).toBe(
          dialect === "mysql"
        );
        expect(seeded.stdout).toContain("Would run the seeders");
        expect((await instance!.adapter.listTables()).sort()).toEqual(before);
      },
      3 * NEXTLY_RUN_TIMEOUT
    );

    it(
      "--accept-data-loss drops every table and rebuilds the migrated ones",
      async () => {
        const before = await migratedWithStray();
        const run = await nextly(["migrate:fresh", "--accept-data-loss"]);
        expect(run.status, run.stdout + run.stderr).toBe(0);
        const after = (await instance!.adapter.listTables()).sort();
        expect(after).not.toContain(STRAY);
        expect(after).toEqual(before.filter(table => table !== STRAY));
      },
      3 * NEXTLY_RUN_TIMEOUT
    );
  }
);
