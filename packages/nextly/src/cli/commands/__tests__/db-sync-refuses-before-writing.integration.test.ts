/**
 * `nextly db:sync` refuses before its first write, run as a shell runs it, on every dialect this
 * run can reach. Each refusal is asserted against the whole database (every table's columns and
 * rows, the schema lock's own tables aside) and the configuration file:
 *
 * - with `NODE_ENV=production` on an empty database it creates no table, and names
 *   `migrate:create` and `nextly migrate`;
 * - with `NODE_ENV=production` on a development database whose configuration changed, the sync,
 *   `--no-auto-sync`, `--promote` and `--demote` each change nothing, and their dry runs name the
 *   refusal and exit 0;
 * - with another process holding the schema lock it waits, is refused, and adds nothing, the
 *   core tables and indexes an older build's SQLite database lacks included;
 * - after each, a development `db:sync` succeeds, so no refusal left the lock held.
 */
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  LOCK_DIALECTS,
  lockWorld,
  startHolder,
  type Holder,
  type LockWorld,
} from "../../../domains/schema/pipeline/__tests__/helpers/schema-lock-world";
import { databaseState } from "../../__tests__/helpers/database-state";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";
import { createLogger } from "../../utils/logger";
import { collectionRegistryOn } from "../db-sync-registry";

/** A collection in code throughout; the second configuration adds a column to it. */
const POSTS = "dsr_posts";
/** In code in the second configuration only, never synced: what a demote registers. */
const MOVED = "dsr_moved";
/** Built in the Schema Builder: what a promote moves to code. */
const BUILT = "dsr_built";
/** A core index the SQLite replay creates, dropped to stand for an older build's database. */
const CORE_INDEX = "users_created_at_idx";

const TITLE = `{ name: "title", type: "text" }`;
const SUMMARY = `{ name: "summary", type: "text" }`;

const CONFIG_V1 = `export default {
  collections: [{ slug: "${POSTS}", fields: [${TITLE}] }],
};
`;
const CONFIG_V2 = `export default {
  collections: [
    { slug: "${POSTS}", fields: [${TITLE}, ${SUMMARY}] },
    { slug: "${MOVED}", fields: [${TITLE}] },
  ],
};
`;

const logger = createLogger({ quiet: true });

describe.each(LOCK_DIALECTS)(
  "db:sync refuses before its first write on %s",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let project: string;
    let holder: Holder | undefined;
    const configFile = () => join(project, "nextly.config.ts");

    /** `nextly <args>` in the project, against this world's database. */
    const nextly = (
      args: string[],
      env: Record<string, string | undefined> = {}
    ) =>
      runNextly(args, project, {
        NODE_ENV: undefined,
        CI: undefined,
        NEXTLY_ACCEPT_DATA_LOSS: undefined,
        DB_DIALECT: world.dialect,
        DATABASE_URL:
          world.dialect === "sqlite" ? `file:${world.url}` : world.url,
        NEXTLY_SECRET: randomBytes(32).toString("hex"),
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        ...env,
      });

    /** What a refusal must leave alone: the whole database and the configuration file. */
    const state = async () => ({
      database: await databaseState(adapter, dialect),
      config: readFileSync(configFile(), "utf8"),
    });

    /** Runs `args` in production, and asserts the refusal, its words, and nothing changed. */
    async function refusedInProduction(args: string[]): Promise<void> {
      const before = await state();
      const run = await nextly(args, { NODE_ENV: "production" });
      const label = args.join(" ");
      // The database first: what the refusal says matters only once it has left it alone.
      expect(await state(), label).toEqual(before);
      expect(run.status, `${label}\n${run.stdout}${run.stderr}`).toBe(1);
      expect(run.stderr, label).toContain(
        "db:sync does not run in production."
      );
      expect(run.stderr, label).toContain("Nothing was changed.");
      expect(run.stderr, label).toContain("nextly migrate:create");
      expect(run.stderr, label).toContain("run `nextly migrate` against");
    }

    /** Runs the dry run of `args` in production: exit 0, the refusal named, nothing changed. */
    async function dryRunNamesTheRefusal(args: string[]): Promise<void> {
      const before = await state();
      const run = await nextly([...args, "--dry-run"], {
        NODE_ENV: "production",
      });
      const label = args.join(" ");
      expect(run.status, `${label}\n${run.stdout}${run.stderr}`).toBe(0);
      expect(run.stdout, label).toContain(
        "A real run would refuse: db:sync does not run in production."
      );
      expect(run.stdout, label).toContain("nextly migrate:create");
      expect(run.stdout, label).not.toMatch(/^ℹ Would /m);
      expect(await state(), label).toEqual(before);
    }

    const postsColumns = async (): Promise<string[]> => {
      const { shape } = await databaseState(adapter, dialect);
      const tables = (
        shape as { tables: { name: string; columns: { name: string }[] }[] }
      ).tables;
      return (
        tables
          .find(table => table.name === `dc_${POSTS}`)
          ?.columns.map(column => column.name) ?? []
      );
    };

    beforeAll(async () => {
      // A database of its own with nothing in it: the first run is the one that would build it.
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      project = realpathSync(
        mkdtempSync(join(tmpdir(), "nextly-db-sync-refuses-"))
      );
      writeFileSync(configFile(), CONFIG_V1);
    }, 120_000);

    afterAll(async () => {
      if (holder !== undefined) {
        holder.kill("SIGKILL");
        await holder.exited;
      }
      await adapter?.disconnect();
      if (project !== undefined)
        rmSync(project, { recursive: true, force: true });
      await world?.dispose();
    }, 60_000);

    it(
      "refuses in production on an empty database, creating no table",
      async () => {
        await refusedInProduction(["db:sync"]);
        expect(await adapter.tableExists("users")).toBe(false);
        // The refusal held nothing: the development sync builds the database at once.
        const sync = await nextly(["db:sync"]);
        expect(sync.status, sync.stdout + sync.stderr).toBe(0);
        expect(await postsColumns()).toContain("title");
      },
      3 * NEXTLY_RUN_TIMEOUT
    );

    it(
      "refuses every mode in production on a database whose configuration changed",
      async () => {
        await collectionRegistryOn(adapter, logger).registerCollection({
          slug: BUILT,
          labels: { singular: BUILT, plural: BUILT },
          tableName: `dc_${BUILT}`,
          fields: [{ name: "title", type: "text" }] as never,
          source: "ui",
          schemaHash: `dsr-${BUILT}`,
          configPath: "dsr",
        });
        writeFileSync(configFile(), CONFIG_V2);

        await refusedInProduction(["db:sync"]);
        await refusedInProduction(["db:sync", "--no-auto-sync"]);
        await refusedInProduction(["db:sync", "--promote", BUILT, "--yes"]);
        await refusedInProduction(["db:sync", "--demote", MOVED, "--yes"]);
        await dryRunNamesTheRefusal(["db:sync"]);
        await dryRunNamesTheRefusal(["db:sync", "--promote", BUILT]);

        // The development sync afterwards makes the change the refusals left alone.
        expect(await postsColumns()).not.toContain("summary");
        const sync = await nextly(["db:sync"]);
        expect(sync.status, sync.stdout + sync.stderr).toBe(0);
        expect(await postsColumns()).toContain("summary");
      },
      8 * NEXTLY_RUN_TIMEOUT
    );

    it(
      "waits for a held lock and is refused, adding nothing",
      async () => {
        // As an older build left it: SQLite replays its core statements on every sync, which
        // puts back whatever the database lacks.
        if (dialect === "sqlite") {
          await adapter.executeQuery(`DROP INDEX "${CORE_INDEX}"`);
        }
        writeFileSync(
          configFile(),
          CONFIG_V2.replace(
            SUMMARY,
            `${SUMMARY}, { name: "body", type: "text" }`
          )
        );
        holder = startHolder(world, {
          command: "nextly migrate",
          // Longer than the minute the sync waits, and its compiling before that.
          leaseSeconds: 240,
          prefix: "dsr_holder",
        });
        await holder.printed("held");
        // The holder's own first table is part of the state from here on.
        const before = await state();

        const run = await nextly(["db:sync"]);
        expect(run.status, run.stdout + run.stderr).toBe(1);
        expect(run.stderr).toContain("nextly migrate");
        expect(await state()).toEqual(before);

        holder.send("release");
        await holder.printed("released");
        await holder.exited;
        holder = undefined;
        const sync = await nextly(["db:sync"]);
        expect(sync.status, sync.stdout + sync.stderr).toBe(0);
        expect(await postsColumns()).toContain("body");
      },
      3 * NEXTLY_RUN_TIMEOUT
    );
  }
);
