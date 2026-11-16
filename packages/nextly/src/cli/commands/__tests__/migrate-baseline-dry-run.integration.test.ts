/**
 * `nextly migrate:baseline --dry-run`, run as a shell runs it against a database `db:sync` would
 * have built, changes nothing: the same tables, the same ledger rows, the same project folder. It
 * names the migration and snapshot it would write and the ledger row it would record, and the
 * real run on the same project then writes and records exactly those, which shows the fixture
 * reaches what the dry run skips, on every configured dialect.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import { folderSnapshot } from "../../__tests__/helpers/folder-snapshot";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";

/** This file's own collection, so its table is its own. */
const COLLECTION = "mbd_posts";

const CONFIG = `
export default {
  collections: [{ slug: "${COLLECTION}", fields: [{ name: "title", type: "text" }] }],
  db: { migrationsDir: "./migrations" },
};
`;

const LEDGER = "nextly_schema_events";

/** A timestamp in a migration's name, which two runs a moment apart do not share. */
const TIMESTAMP = /\d{8}_\d{6}_\d{3}/;

describe.each(getConfiguredTestDialects())(
  "migrate:baseline --dry-run (%s)",
  (dialect: TestDialect) => {
    let project: string;
    let databaseDir: string | undefined;
    let instance: TestNextly | undefined;
    let databaseUrl: string | undefined;
    let databaseDialect: string | undefined;

    beforeEach(async () => {
      project = mkdtempSync(join(tmpdir(), "nextly-baseline-dry-run-"));
      writeFileSync(join(project, "nextly.config.ts"), CONFIG);
      databaseUrl = process.env.DATABASE_URL;
      databaseDialect = process.env.DB_DIALECT;
      // The collection's table is created by the boot's schema push, as `db:sync` creates it:
      // a database with tables and no migration history.
      const collections = [
        defineCollection({
          slug: COLLECTION,
          fields: [text({ name: "title" })],
        }),
      ];
      if (dialect === "sqlite") {
        // A file the commands' own connections open, which in-memory is not. Outside the project,
        // so the project folder holds only what the commands write there.
        databaseDir = mkdtempSync(
          join(tmpdir(), "nextly-baseline-dry-run-db-")
        );
        const url = `file:${join(databaseDir, "test.db")}`;
        process.env.DB_DIALECT = "sqlite";
        process.env.DATABASE_URL = url;
        _resetEnvCache();
        instance = await createTestNextly({
          collections,
          adapter: await createAdapter({ type: "sqlite", url } as Parameters<
            typeof createAdapter
          >[0]),
        });
      } else {
        // Points DATABASE_URL at a database of its own for this test.
        instance = await createTestNextly({ dialect, collections });
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
      if (databaseDir !== undefined) {
        rmSync(databaseDir, { recursive: true, force: true });
        databaseDir = undefined;
      }
    });

    const nextly = (args: string[]) =>
      runNextly(args, project, {
        NODE_ENV: undefined,
        NEXTLY_SECRET: randomBytes(32).toString("hex"),
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      });

    /** The database's tables, every ledger row, and the project folder. */
    async function state(): Promise<{
      tables: string[];
      ledger: unknown[];
      folder: Record<string, string>;
    }> {
      const adapter = instance!.adapter;
      const tables = (await adapter.listTables()).sort();
      const ledger = tables.includes(LEDGER)
        ? await adapter.executeQuery(`SELECT * FROM ${LEDGER} ORDER BY id`)
        : [];
      return { tables, ledger, folder: folderSnapshot(project) };
    }

    it(
      "changes nothing, and names what the real run then writes and records",
      async () => {
        const before = await state();
        expect(before.tables).toContain(`dc_${COLLECTION}`);

        const dry = await nextly(["migrate:baseline", "--dry-run"]);
        expect(dry.status, dry.stdout + dry.stderr).toBe(0);
        expect(dry.stdout).toContain("Dry run: nothing was changed.");
        expect(await state()).toEqual(before);

        const real = await nextly(["migrate:baseline"]);
        expect(real.status, real.stdout + real.stderr).toBe(0);
        const after = await state();
        expect(after.ledger.length).toBeGreaterThan(before.ledger.length);

        // The files the dry run named are the files the real run wrote.
        const written = Object.keys(after.folder)
          .filter(path => !(path in before.folder))
          .filter(path => /\.(sql|json)$/.test(path));
        const named = [...dry.stdout.matchAll(/Would write (\S+)/g)].map(
          m => m[1]
        );
        const unstamped = (paths: string[]) =>
          paths.map(path => path.replace(TIMESTAMP, "<ts>")).sort();
        expect(written).toHaveLength(2);
        expect(unstamped(named)).toEqual(unstamped(written));

        // The ledger row it named is the row the real run recorded.
        const recorded = /Would record (\S+\.sql)/.exec(dry.stdout)?.[1];
        expect(recorded).toBeDefined();
        const sqlFile = written.find(path => path.endsWith(".sql"))!;
        expect(recorded!.replace(TIMESTAMP, "<ts>")).toBe(
          sqlFile.replace(/^migrations\//, "").replace(TIMESTAMP, "<ts>")
        );
        expect(JSON.stringify(after.ledger)).toContain(
          sqlFile.replace(/^migrations\//, "")
        );

        // The ledger table is named as one the run creates exactly when it was missing.
        expect(dry.stdout.includes(`create the ledger table ${LEDGER}`)).toBe(
          !before.tables.includes(LEDGER)
        );
      },
      3 * NEXTLY_RUN_TIMEOUT
    );

    it(
      "reports the refusal of a project already baselined, and exits 0",
      async () => {
        const real = await nextly(["migrate:baseline"]);
        expect(real.status, real.stdout + real.stderr).toBe(0);
        const before = await state();

        const dry = await nextly(["migrate:baseline", "--dry-run"]);
        expect(dry.status, dry.stdout + dry.stderr).toBe(0);
        expect(dry.stdout).toMatch(
          /A real run would refuse: This project already has a migration history/
        );
        expect(await state()).toEqual(before);
      },
      3 * NEXTLY_RUN_TIMEOUT
    );

    it(
      "names the lock --force-unlock clears even where the real run then refuses",
      async () => {
        const real = await nextly(["migrate:baseline"]);
        expect(real.status, real.stdout + real.stderr).toBe(0);
        const before = await state();

        // A real run clears the lock before it reaches the refusal, so the
        // dry run names that change beside the refusal.
        const dry = await nextly([
          "migrate:baseline",
          "--dry-run",
          "--force-unlock",
        ]);
        expect(dry.status, dry.stdout + dry.stderr).toBe(0);
        expect(dry.stdout).toContain("Would remove any migrate lock held");
        expect(dry.stdout).toMatch(/A real run would refuse: /);
        expect(await state()).toEqual(before);
      },
      3 * NEXTLY_RUN_TIMEOUT
    );
  }
);
