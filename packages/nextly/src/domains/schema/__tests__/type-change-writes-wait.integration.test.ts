/**
 * Writes made while a type change converts a field's values on MySQL, between the values' copy into
 * the column beside and that copy taking the column's place: none is answered as stored and then
 * lost under a value copied before it. Asked of every road that would convert there: a collection's,
 * a Single's and a field group's Schema Builder save, `nextly migrate` and `migrate:down`.
 *
 * - No road rewrites values on MySQL (`rewritesValuesOn`), as no hold keeps writes out on all of
 *   them: each refuses a change that would rewrite any value before any statement, the column, its
 *   values and the migrations as they were, and a write made then is stored.
 * - Where one does, each write is held until the change ends, or stopped. Those cases are skipped
 *   until then, by that one answer.
 *
 * What separates the right answer from a plausible wrong one: a road with no hold answers the write
 * as stored, then overwrites it with the value it copied, or leaves an inserted row empty.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore } from "../../../cli/commands/migrate";
import {
  downDatabaseDeps,
  migrateDownCore,
} from "../../../cli/commands/migrate-down";
import { createLogger } from "../../../cli/utils/logger";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { readConvertsMark } from "../migrate/converts-header";
import { resolveDataLossConsent } from "../migrate/data-loss-consent";
import { marksNoTransaction } from "../migrate/split-sql";
import { parseSqlSections } from "../migrate/sql-sections";
import { withMigrateLock } from "../pipeline/locks";
import { rewritesValuesOn } from "../value-conversion/type-change/field-type-changes";

/** What runs as the column is about to be emptied, once the values are copied beside it. */
const atCopyBack = vi.hoisted(() => ({
  hook: undefined as (() => Promise<void>) | undefined,
  fired: 0,
}));

vi.mock("../pipeline/_internal/run-statement", async original => {
  const actual =
    await original<typeof import("../pipeline/_internal/run-statement")>();
  return {
    ...actual,
    runStatement: async (db: unknown, dialect: never, statement: unknown) => {
      const text =
        dialect === "mysql"
          ? new MySqlDialect().sqlToQuery(statement as never).sql
          : "";
      if (/^UPDATE `[^`]+` SET `v` = NULL$/.test(text.trim())) {
        atCopyBack.fired += 1;
        const hook = atCopyBack.hook;
        atCopyBack.hook = undefined;
        await hook?.();
      }
      return actual.runStatement(db, dialect, statement);
    },
  };
});

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const SLUG = "tcw_posts";

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-type-change-writes-"));
  vi.stubEnv("NODE_ENV", "development");
  atCopyBack.hook = undefined;
  atCopyBack.fired = 0;
});

afterEach(async () => {
  try {
    await instance?.destroy();
  } finally {
    instance = undefined;
    vi.unstubAllEnvs();
    await rm(basePath, { recursive: true, force: true });
  }
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  instance = await createTestNextly({ dialect, basePath, db: DB });
  return instance;
}

/** How a write ended: stored, or refused with what it said; `waited` where the hook gave up on it. */
interface Ended {
  stored: boolean;
  said?: string;
}

/** Start `write` as the column is emptied, giving it a moment to end before the change goes on. */
function during(write: () => Promise<unknown>): Promise<Ended> {
  // Run as another request runs: outside the save's async context, whose hold lets its own writes by.
  const outside = AsyncLocalStorage.snapshot();
  return new Promise<Ended>(resolve => {
    atCopyBack.hook = async () => {
      const ended = outside(write).then(
        (): Ended => ({ stored: true }),
        (error: unknown): Ended => ({
          stored: false,
          said: error instanceof Error ? error.message : String(error),
        })
      );
      void ended.then(resolve);
      await Promise.race([ended, new Promise(done => setTimeout(done, 1500))]);
    };
  });
}

async function schemaVersion(t: TestNextly, table: string, slug: string) {
  const [row] = await (
    t.adapter as unknown as { executeQuery<R>(s: string): Promise<R[]> }
  ).executeQuery<{ v: number | string | null }>(
    `SELECT schema_version AS v FROM ${table} WHERE slug = '${slug}'`
  );
  return Number(row?.v ?? 1);
}

async function migrateFolder(t: TestNextly, step?: number): Promise<void> {
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

const idOf = (created: unknown): string => {
  const made = created as { item?: { id?: string }; id?: string };
  return made.item?.id ?? made.id ?? "";
};

/** `v` of each entry by title. */
async function entries(t: TestNextly): Promise<Record<string, unknown>> {
  clearRegistryRowCache();
  const found = (await t.nextly.find({
    collection: SLUG,
    limit: 100,
  } as never)) as { items: Array<Record<string, unknown>> };
  return Object.fromEntries(
    found.items.map(item => [String(item.title), item.v ?? null])
  );
}

/** `nextly migrate:down` of the newest migration, its file read with its mark as the command does. */
async function migrateDown(t: TestNextly): Promise<void> {
  const adapter = t.adapter as unknown as DrizzleAdapter;
  const migrationsDir = join(basePath, "migrations");
  await migrateDownCore({
    ...(await downDatabaseDeps({
      adapter,
      dialect: adapter.getCapabilities().dialect,
      migrationsDir,
    })),
    nodeEnv: "test",
    logger: createLogger({ quiet: true }),
    options: {
      step: 1,
      consent: resolveDataLossConsent({ flag: true, env: {} }),
      yes: true,
      dryRun: false,
    },
    fileExists: () => Promise.resolve(true),
    readDownSql: async (filename: string) => {
      const name = filename.endsWith(".sql") ? filename : `${filename}.sql`;
      const content = await readFile(join(migrationsDir, name), "utf-8");
      const converts = readConvertsMark(content, name);
      return {
        sql: parseSqlSections(content).downSql,
        transaction: !marksNoTransaction(content),
        ...(converts === null ? {} : { converts }),
      };
    },
    withLock: withMigrateLock,
  } as Parameters<typeof migrateDownCore>[0]);
  clearRegistryRowCache();
}

/** The names of the folder's migration files, oldest first. */
async function files(): Promise<string[]> {
  return (await readdir(join(basePath, "migrations")))
    .filter(f => f.endsWith(".sql"))
    .sort();
}

/**
 * The newest migration file marked as converting `columns`, as a save where a road rewrites values
 * writes it: the file a MySQL save wrote is the cast's, with no mark.
 */
async function markNewestFile(columns: string): Promise<void> {
  const newest = (await files()).at(-1) ?? "";
  const path = join(basePath, "migrations", newest);
  const text = await readFile(path, "utf-8");
  expect(text).not.toContain("-- Converts values:");
  const marked = text.replace(
    /^-- Generated at:/m,
    `-- Converts values: rules 1; ${columns}\n-- Generated at:`
  );
  expect(readConvertsMark(marked, newest)).not.toBeNull();
  await writeFile(path, marked);
}

/** The columns `table` has, and every `v` it holds, as the database reports them. */
async function tableHolds(t: TestNextly, table: string) {
  const query = <R>(statement: string) =>
    (
      t.adapter as unknown as { executeQuery<T>(s: string): Promise<T[]> }
    ).executeQuery<R>(statement);
  const columns = await query<{ name: string; type: string }>(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' ORDER BY ORDINAL_POSITION`
  );
  const rows = await query<{ v: unknown }>(
    `SELECT v FROM \`${table}\` ORDER BY v`
  );
  return { columns, values: rows.map(row => row.v) };
}

/** The file of a migration recorded applied on `t`'s database, newest last. */
async function recordedFiles(t: TestNextly): Promise<unknown[]> {
  const rows = await (
    t.adapter as unknown as { executeQuery<R>(s: string): Promise<R[]> }
  ).executeQuery<{ filename: string | null }>(
    "SELECT filename FROM nextly_schema_events WHERE event_type = 'file_apply' AND status = 'applied' ORDER BY filename"
  );
  return rows.map(row => row.filename);
}

/** A change refused because a value of it must be rewritten, as `nextly migrate` would be. */
const CANNOT_DEPLOY = /can't be deployed yet/;

/** The message of every issue `change` was refused with. */
async function refusalOf(change: Promise<unknown>): Promise<string> {
  const error = await change.then(
    () => undefined,
    (thrown: unknown) => thrown
  );
  return JSON.stringify(
    (error as { publicData?: { errors?: unknown } } | undefined)?.publicData
      ?.errors ?? "applied"
  );
}

describe.each(getConfiguredTestDialects())(
  "a type change that would rewrite a value is refused where no road holds writes (%s)",
  dialect => {
    const refusing = it.runIf(
      dialect === "mysql" && !rewritesValuesOn(dialect)
    );
    // A text that is a number only once rewritten: the database's cast reads "012" as 12 as well,
    // and the rules write it so, which is why the change is the conversion's and not the cast's.
    const REWRITTEN = "012";
    const NUMBER = [{ name: "v", type: "number" }];

    async function posts(t: TestNextly, v: string): Promise<string> {
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: SLUG, label: "Post", fields: [{ name: "v", type: "text" }] }
      );
      return idOf(
        await t.nextly.create({
          collection: SLUG,
          data: { title: "a", v },
        } as never)
      );
    }
    const saveCollection = async (t: TestNextly) =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: SLUG },
        {
          fields: NUMBER,
          confirmed: true,
          schemaVersion: await schemaVersion(t, "dynamic_collections", SLUG),
        }
      );
    /** The write made once the change is refused, and the values every entry then holds. */
    const afterUpdate = async (t: TestNextly, id: string) => {
      await t.nextly.update({
        collection: SLUG,
        id,
        data: { v: "34", _overwrite: true },
      } as never);
      return entries(t);
    };
    const afterInsert = async (t: TestNextly) => {
      await t.nextly.create({
        collection: SLUG,
        data: { title: "b", v: "56" },
      } as never);
      return entries(t);
    };

    refusing(
      "a collection's Builder save, then an update and an insert",
      async () => {
        const t = await boot(dialect);
        const id = await posts(t, REWRITTEN);
        const before = await tableHolds(t, `dc_${SLUG}`);
        const filesBefore = await files();
        const recorded = await recordedFiles(t);

        expect(await refusalOf(saveCollection(t))).toMatch(CANNOT_DEPLOY);

        expect(await tableHolds(t, `dc_${SLUG}`)).toEqual(before);
        expect(await files()).toEqual(filesBefore);
        expect(await recordedFiles(t)).toEqual(recorded);
        expect(atCopyBack.fired).toBe(0);
        expect(await afterUpdate(t, id)).toEqual({ a: "34" });
        expect(await afterInsert(t)).toEqual({ a: "34", b: "56" });
      }
    );

    refusing("a Single's Builder save, then an update", async () => {
      const t = await boot(dialect);
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "tcw_hero",
          label: "Hero",
          fields: [{ name: "v", type: "text" }],
        }
      );
      const set = (v: string) =>
        t.nextly.updateSingle({
          slug: "tcw_hero",
          data: { v, _overwrite: true },
        } as never);
      await set(REWRITTEN);
      const before = await tableHolds(t, "single_tcw_hero");
      const filesBefore = await files();
      const recorded = await recordedFiles(t);

      expect(
        await refusalOf(
          dispatchSingles(
            "applySingleSchemaChanges",
            { slug: "tcw_hero" },
            {
              fields: NUMBER,
              confirmed: true,
              schemaVersion: await schemaVersion(
                t,
                "dynamic_singles",
                "tcw_hero"
              ),
            }
          )
        )
      ).toMatch(CANNOT_DEPLOY);

      expect(await tableHolds(t, "single_tcw_hero")).toEqual(before);
      expect(await files()).toEqual(filesBefore);
      expect(await recordedFiles(t)).toEqual(recorded);
      expect(atCopyBack.fired).toBe(0);
      await set("34");
      expect((await tableHolds(t, "single_tcw_hero")).values).toEqual(["34"]);
    });

    refusing(
      "a field group's Builder save, then an update and an insert",
      async () => {
        const t = await boot(dialect);
        await dispatchComponents(
          "createComponent",
          {},
          {
            slug: "tcw_box",
            label: "Box",
            fields: [{ name: "v", type: "text" }],
          }
        );
        await dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          {
            name: SLUG,
            label: "Post",
            fields: [{ name: "box", type: "component", component: "tcw_box" }],
          }
        );
        const id = idOf(
          await t.nextly.create({
            collection: SLUG,
            data: { title: "a", box: { v: REWRITTEN } },
          } as never)
        );
        const stored = (await t
          .getService("fieldGroupRegistryService")
          .getComponent("tcw_box")) as {
          schemaVersion?: number;
          tableName: string;
        };
        const before = await tableHolds(t, stored.tableName);
        const filesBefore = await files();
        const recorded = await recordedFiles(t);

        expect(
          await refusalOf(
            dispatchComponents(
              "applyComponentSchemaChanges",
              { slug: "tcw_box" },
              {
                fields: NUMBER,
                confirmed: true,
                schemaVersion: stored.schemaVersion,
              }
            )
          )
        ).toMatch(CANNOT_DEPLOY);

        expect(await tableHolds(t, stored.tableName)).toEqual(before);
        expect(await files()).toEqual(filesBefore);
        expect(await recordedFiles(t)).toEqual(recorded);
        expect(atCopyBack.fired).toBe(0);
        await t.nextly.update({
          collection: SLUG,
          id,
          data: { box: { v: "34" }, _overwrite: true },
        } as never);
        await t.nextly.create({
          collection: SLUG,
          data: { title: "b", box: { v: "56" } },
        } as never);
        expect((await tableHolds(t, stored.tableName)).values).toEqual([
          "34",
          "56",
        ]);
      }
    );

    /** A second database at the first file, whose later file, marked, makes `from` into `to`. */
    async function beforeMarkedChange(
      from: Record<string, unknown>,
      to: Record<string, unknown>,
      held: unknown
    ): Promise<TestNextly> {
      const first = await boot(dialect);
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: SLUG, label: "Post", fields: [{ name: "v", ...from }] }
      );
      const created = (await files()).length;
      await first.nextly.create({
        collection: SLUG,
        data: { title: "a", v: held },
      } as never);
      await dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: SLUG },
        {
          fields: [{ name: "v", ...to }],
          confirmed: true,
          schemaVersion: await schemaVersion(
            first,
            "dynamic_collections",
            SLUG
          ),
        }
      );
      await markNewestFile(`dc_${SLUG}.v`);
      await first.destroy();
      instance = undefined;
      const second = await boot(dialect);
      await migrateFolder(second, created);
      return second;
    }

    refusing(
      "nextly migrate of a marked file, then an update and an insert",
      async () => {
        const t = await beforeMarkedChange(
          { type: "text" },
          { type: "number" },
          "12"
        );
        const id = idOf(
          await t.nextly.create({
            collection: SLUG,
            data: { title: "a", v: REWRITTEN },
          } as never)
        );
        const before = await tableHolds(t, `dc_${SLUG}`);
        const recorded = await recordedFiles(t);

        expect(await refusalOf(migrateFolder(t))).toMatch(CANNOT_DEPLOY);

        expect(await tableHolds(t, `dc_${SLUG}`)).toEqual(before);
        expect(await recordedFiles(t)).toEqual(recorded);
        expect(atCopyBack.fired).toBe(0);
        expect(await afterUpdate(t, id)).toEqual({ a: "34" });
        expect(await afterInsert(t)).toEqual({ a: "34", b: "56" });
      }
    );

    // A change the database's cast reads alike is no conversion: the marked file still runs.
    refusing(
      "runs a marked file whose values the cast reads as the rules do",
      async () => {
        const t = await beforeMarkedChange(
          { type: "text" },
          { type: "number" },
          "12"
        );
        await t.nextly.create({
          collection: SLUG,
          data: { title: "a", v: "34" },
        } as never);

        await migrateFolder(t);

        expect(await entries(t)).toEqual({ a: 34 });
      }
    );

    refusing("migrate:down of a marked change", async () => {
      const t = await beforeMarkedChange(
        { type: "number" },
        { type: "text" },
        12
      );
      await migrateFolder(t);
      await t.nextly.create({
        collection: SLUG,
        data: { title: "a", v: REWRITTEN },
      } as never);
      const before = await tableHolds(t, `dc_${SLUG}`);
      const recorded = await recordedFiles(t);

      expect(await refusalOf(migrateDown(t))).toMatch(CANNOT_DEPLOY);

      expect(await tableHolds(t, `dc_${SLUG}`)).toEqual(before);
      expect(await recordedFiles(t)).toEqual(recorded);
      expect(await entries(t)).toEqual({ a: REWRITTEN });
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a write made while a type change converts a field's values is never lost (%s)",
  dialect => {
    const converting = it.runIf(
      dialect === "mysql" && rewritesValuesOn(dialect)
    );
    async function posts(t: TestNextly): Promise<string> {
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: SLUG, label: "Post", fields: [{ name: "v", type: "text" }] }
      );
      const id = idOf(
        await t.nextly.create({
          collection: SLUG,
          data: { title: "a", v: "12" },
        } as never)
      );
      return id;
    }
    const saveCollection = async (t: TestNextly) =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: SLUG },
        {
          fields: [{ name: "v", type: "number" }],
          confirmed: true,
          schemaVersion: await schemaVersion(t, "dynamic_collections", SLUG),
        }
      );
    const update = (t: TestNextly, id: string) => () =>
      t.nextly.update({
        collection: SLUG,
        id,
        data: { v: "34", _overwrite: true },
      } as never);
    const insert = (t: TestNextly) => () =>
      t.nextly.create({
        collection: SLUG,
        data: { title: "b", v: "56" },
      } as never);

    converting("a collection's Builder save: an update", async () => {
      const t = await boot(dialect);
      const id = await posts(t);
      const written = during(update(t, id));
      await saveCollection(t);
      expect(atCopyBack.fired).toBe(1);
      const ended = await written;
      expect([ended, await entries(t)]).toEqual([
        ended,
        { a: ended.stored ? 34 : 12 },
      ]);
    });

    converting("a collection's Builder save: an insert", async () => {
      const t = await boot(dialect);
      await posts(t);
      const written = during(insert(t));
      await saveCollection(t);
      expect(atCopyBack.fired).toBe(1);
      const ended = await written;
      expect([ended, await entries(t)]).toEqual([
        ended,
        ended.stored ? { a: 12, b: 56 } : { a: 12 },
      ]);
    });

    async function deployed(): Promise<[TestNextly, string]> {
      const first = await boot(dialect);
      await posts(first);
      const created = (await readdir(join(basePath, "migrations"))).filter(f =>
        f.endsWith(".sql")
      ).length;
      await saveCollection(first);
      await first.destroy();
      instance = undefined;
      atCopyBack.fired = 0;
      const second = await boot(dialect);
      await migrateFolder(second, created);
      const id = idOf(
        await second.nextly.create({
          collection: SLUG,
          data: { title: "a", v: "12" },
        } as never)
      );
      return [second, id];
    }

    converting("nextly migrate: an update", async () => {
      const [t, id] = await deployed();
      const written = during(update(t, id));
      await migrateFolder(t);
      expect(atCopyBack.fired).toBe(1);
      const ended = await written;
      expect([ended, await entries(t)]).toEqual([
        ended,
        { a: ended.stored ? 34 : 12 },
      ]);
    });

    converting("nextly migrate: an insert", async () => {
      const [t] = await deployed();
      const written = during(insert(t));
      await migrateFolder(t);
      expect(atCopyBack.fired).toBe(1);
      const ended = await written;
      expect([ended, await entries(t)]).toEqual([
        ended,
        ended.stored ? { a: 12, b: 56 } : { a: 12 },
      ]);
    });

    converting("a Single's Builder save: an update", async () => {
      const t = await boot(dialect);
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "tcw_hero",
          label: "Hero",
          fields: [{ name: "v", type: "text" }],
        }
      );
      const set = (v: string) =>
        t.nextly.updateSingle({
          slug: "tcw_hero",
          data: { v, _overwrite: true },
        } as never);
      await set("12");
      const written = during(() => set("34"));
      await dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "tcw_hero" },
        {
          fields: [{ name: "v", type: "number" }],
          confirmed: true,
          schemaVersion: await schemaVersion(t, "dynamic_singles", "tcw_hero"),
        }
      );
      expect(atCopyBack.fired).toBe(1);
      const ended = await written;
      const read = (await t.nextly.findSingle({
        slug: "tcw_hero",
      } as never)) as { v?: unknown; item?: { v?: unknown } };
      expect([ended, read.item?.v ?? read.v]).toEqual([
        ended,
        ended.stored ? 34 : 12,
      ]);
    });

    async function boxed(t: TestNextly): Promise<string> {
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "tcw_box", label: "Box", fields: [{ name: "v", type: "text" }] }
      );
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: SLUG,
          label: "Post",
          fields: [{ name: "box", type: "component", component: "tcw_box" }],
        }
      );
      return idOf(
        await t.nextly.create({
          collection: SLUG,
          data: { title: "a", box: { v: "12" } },
        } as never)
      );
    }
    const saveBox = async (t: TestNextly) => {
      const stored = (await t
        .getService("fieldGroupRegistryService")
        .getComponent("tcw_box")) as { schemaVersion?: number };
      return dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "tcw_box" },
        {
          fields: [{ name: "v", type: "number" }],
          confirmed: true,
          schemaVersion: stored.schemaVersion,
        }
      );
    };
    const boxes = async (t: TestNextly) => {
      clearRegistryRowCache();
      const found = (await t.nextly.find({
        collection: SLUG,
        limit: 100,
      } as never)) as unknown as {
        items: Array<{ title: string; box?: { v?: unknown } }>;
      };
      return Object.fromEntries(
        found.items.map(item => [item.title, item.box?.v ?? null])
      );
    };

    converting("a field group's Builder save: an update", async () => {
      const t = await boot(dialect);
      const id = await boxed(t);
      const written = during(() =>
        t.nextly.update({
          collection: SLUG,
          id,
          data: { box: { v: "34" }, _overwrite: true },
        } as never)
      );
      await saveBox(t);
      expect(atCopyBack.fired).toBe(1);
      const ended = await written;
      expect([ended, await boxes(t)]).toEqual([
        ended,
        { a: ended.stored ? 34 : 12 },
      ]);
    });

    converting("a field group's Builder save: an insert", async () => {
      const t = await boot(dialect);
      await boxed(t);
      const written = during(() =>
        t.nextly.create({
          collection: SLUG,
          data: { title: "b", box: { v: "56" } },
        } as never)
      );
      await saveBox(t);
      expect(atCopyBack.fired).toBe(1);
      const ended = await written;
      expect([ended, await boxes(t)]).toEqual([
        ended,
        ended.stored ? { a: 12, b: 56 } : { a: 12 },
      ]);
    });
  }
);
