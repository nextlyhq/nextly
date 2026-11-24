/**
 * A field type change that converts values, over a table another session holds: the conversion waits
 * with its file, in tries within the bounds, then stops as a busy table, and every value is as it was.
 * Once the holder ends, on a later try or a later run, each value is converted once. On a Schema
 * Builder save and `nextly migrate`.
 *
 * The holder is an open transaction that has read the table on PostgreSQL, so the conversion's first
 * statement waits for its lock; on SQLite an open write transaction on a second connection to the file,
 * which holds the whole database, so a save and a run stop at the schema lock, before it. On MySQL no
 * road rewrites values (`rewritesValuesOn`), and a change the cast reads alike waits as any other does.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore } from "../../../cli/commands/migrate";
import { createLogger } from "../../../cli/utils/logger";
import { createAdapter } from "../../../database/factory";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { _resetEnvCache } from "../../../shared/lib/env";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { resolveDataLossConsent } from "../migrate/data-loss-consent";
import { rewritesValuesOn } from "../value-conversion/type-change/field-type-changes";

const SLUG = "tcb_posts";
const TABLE = `dc_${SLUG}`;
const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const text = { name: "v", type: "text" };
const number = { name: "v", type: "number" };

describe.each(getConfiguredTestDialects())(
  "a type change's conversion over a table another session holds (%s)",
  dialect => {
    const converts = it.skipIf(!rewritesValuesOn(dialect));
    let instance: TestNextly | undefined;
    let holder: DrizzleAdapter | undefined;
    let basePath: string;
    let free: () => void = () => {};
    let holding: Promise<unknown> = Promise.resolve();

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-type-change-busy-"));
      vi.stubEnv("NODE_ENV", "development");
      // Short bounds, so the tries run in seconds: one second a try, four in all.
      vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "1");
      vi.stubEnv("NEXTLY_LOCK_TIMEOUT_TOTAL", "4");
    });

    afterEach(async () => {
      free();
      await holding.catch(() => {});
      await holder?.disconnect();
      holder = undefined;
      await instance?.destroy();
      instance = undefined;
      vi.unstubAllEnvs();
      _resetEnvCache();
      await rm(basePath, { recursive: true, force: true });
    });

    /** The instance, on SQLite over a file a second connection can open. */
    async function boot(database = "first"): Promise<TestNextly> {
      if (dialect !== "sqlite") {
        instance = await createTestNextly({ dialect, basePath, db: DB });
        return instance;
      }
      const url = `file:${join(basePath, `${database}.db`)}`;
      vi.stubEnv("DB_DIALECT", "sqlite");
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
      const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
        typeof createAdapter
      >[0]);
      instance = await createTestNextly({ adapter, basePath, db: DB });
      return instance;
    }

    async function exec<R>(t: TestNextly, statement: string): Promise<R[]> {
      return (
        t.adapter as unknown as { executeQuery<T>(s: string): Promise<T[]> }
      ).executeQuery<R>(statement);
    }

    async function createPosts(): Promise<void> {
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: SLUG, label: "Post", fields: [text] }
      );
    }

    async function write(t: TestNextly, title: string, v: unknown) {
      await t.nextly.create({ collection: SLUG, data: { title, v } } as never);
    }

    /** The dialog's save of `v` as a number, answering its refusal where it has one. */
    async function save(t: TestNextly): Promise<unknown> {
      const [row] = await exec<{ v: number | string | null }>(
        t,
        `SELECT schema_version AS v FROM dynamic_collections WHERE slug = '${SLUG}'`
      );
      const outcome = await dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: SLUG },
        {
          fields: [number],
          confirmed: true,
          schemaVersion: Number(row?.v ?? 1),
        }
      ).then(
        () => undefined,
        (error: unknown) => error
      );
      clearRegistryRowCache();
      return outcome;
    }

    async function migrate(t: TestNextly, step?: number): Promise<void> {
      const adapter = t.adapter as unknown as DrizzleAdapter;
      await migrateCore({
        ...(step === undefined ? {} : { step }),
        extensionSchema: undefined,
        dialect: adapter.getCapabilities().dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir: join(basePath, "migrations"),
        logger: createLogger({ quiet: true }),
        lockMode: "fail-fast",
        consent: resolveDataLossConsent({ flag: true, env: {} }),
        interactive: false,
        throwOnFailure: true,
      } as never);
      clearRegistryRowCache();
    }

    /** Another session holds the collection's table until `free()`. */
    async function holdTheTable(
      t: TestNextly,
      database = "first"
    ): Promise<void> {
      let held: () => void = () => {};
      const isHeld = new Promise<void>(resolve => {
        held = resolve;
      });
      const freed = new Promise<void>(resolve => {
        free = resolve;
      });
      const on =
        dialect === "sqlite"
          ? (holder = (await createAdapter({
              type: "sqlite",
              url: `file:${join(basePath, `${database}.db`)}`,
            } as Parameters<
              typeof createAdapter
            >[0])) as unknown as DrizzleAdapter)
          : (t.adapter as unknown as DrizzleAdapter);
      holding = on.transaction(async tx => {
        await tx.execute(
          dialect === "sqlite"
            ? `UPDATE ${TABLE} SET title = title`
            : `SELECT id FROM ${TABLE}`
        );
        held();
        await freed;
      });
      await isHeld;
    }

    /** The table's columns, its values, the project's files and the registry's fields. */
    async function standing(t: TestNextly) {
      const columns = await exec<{ name: string; type: string }>(
        t,
        dialect === "sqlite"
          ? `SELECT name, type FROM pragma_table_info('${TABLE}')`
          : `SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_name = '${TABLE}' ORDER BY ordinal_position`
      );
      const [row] = await exec<{ fields: unknown; v: unknown }>(
        t,
        `SELECT fields, schema_version AS v FROM dynamic_collections WHERE slug = '${SLUG}'`
      );
      return {
        columns,
        values: await exec(t, `SELECT title, v FROM ${TABLE} ORDER BY title`),
        files: (await readdir(join(basePath, "migrations"))).sort(),
        registry: JSON.stringify(row),
      };
    }

    /** Each entry's `v`, by title, as the table holds it. */
    async function values(t: TestNextly): Promise<Record<string, unknown>> {
      const rows = await exec<{ title: string; v: unknown }>(
        t,
        `SELECT title, v FROM ${TABLE}`
      );
      return Object.fromEntries(rows.map(row => [row.title, row.v]));
    }

    converts(
      "stops a save as a busy table with every value as it was, and converts them once the holder ends",
      async () => {
        const t = await boot();
        await createPosts();
        await write(t, "a", "012");
        await write(t, "b", "7");
        const before = await standing(t);
        await holdTheTable(t);

        const stopped = await save(t);

        free();
        await holding;
        expect(stopped).toMatchObject({
          code: "NEXTLY_TABLE_BUSY",
          statusCode: 409,
        });
        expect(await standing(t)).toEqual(before);

        expect(await save(t)).toBeUndefined();
        expect(await values(t)).toEqual({ a: 12, b: 7 });
      },
      60_000
    );

    // Freed during the first pause, after the first try ended waiting: the next try judges and converts
    // afresh, and a value the holder's end let through is converted with the rest.
    converts.skipIf(dialect === "sqlite")(
      "converts the values on a later try once the table is free",
      async () => {
        const t = await boot();
        await createPosts();
        await write(t, "a", "012");
        await holdTheTable(t);
        setTimeout(() => free(), 1_500);

        expect(await save(t)).toBeUndefined();

        expect(await values(t)).toEqual({ a: 12 });
        const { columns } = await standing(t);
        expect(columns.map(column => column.name)).not.toContain(
          "__nextly_converted"
        );
      },
      60_000
    );

    converts(
      "stops nextly migrate as a busy table with every value as it was, and converts them once the holder ends",
      async () => {
        const first = await boot();
        await createPosts();
        const created = (await readdir(join(basePath, "migrations"))).filter(
          file => file.endsWith(".sql")
        ).length;
        await write(first, "here", "12");
        expect(await save(first)).toBeUndefined();
        await first.destroy();
        instance = undefined;

        const second = await boot("second");
        await migrate(second, created);
        await write(second, "a", "034");
        const before = await standing(second);
        await holdTheTable(second, "second");

        await expect(migrate(second)).rejects.toMatchObject({
          code: "NEXTLY_TABLE_BUSY",
        });

        free();
        await holding;
        expect(await standing(second)).toEqual(before);

        await migrate(second);
        expect(await values(second)).toEqual({ a: 34 });
      },
      60_000
    );
  }
);
