/**
 * The legacy batch writes report each failed item's own code, on every
 * dialect, through the plugin-facing `createMany` / `updateMany`, the entry
 * service's `deleteEntries`, and a `*InTransaction` twin inside a caller's
 * transaction.
 *
 * Each not-migrated case boots with the collection migrated and written, then
 * takes away what a skipped `nextly migrate` would leave missing: a declared
 * field's column, or the collection's table. Every single-entry write already
 * answers ENTITY_NOT_MIGRATED (409) for that; the batch reported only each
 * item's message, and a stopOnError batch in a caller's transaction answered
 * INTERNAL_ERROR 500 in place of the item's own error.
 *
 * A healthy-table batch where one item names no row pins that the code is the
 * item's OWN: an implementation that stamped one code on every failed item,
 * or threw ENTITY_NOT_MIGRATED for any stopOnError abort, reports the
 * not-found item as not-migrated and fails there.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { grantPublic } from "../../../__tests__/helpers/public-role";
import { defineCollection, text } from "../../../config";
import { NextlyError } from "../../../errors/nextly-error";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

const POSTS = "lb_posts";
/** Its table, as the registry names it. */
const POSTS_TABLE = `dc_${POSTS}`;
/** The title whose write answers another collection not migrated. */
const FOREIGN_TITLE = "Reaches authors";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

function t(): TestNextly {
  if (!current) throw new Error("not booted");
  return current;
}

type Services = PluginContext["services"];

/** One failed item of a batch, as a caller reads it. */
interface BatchError {
  index: number;
  error: string;
  code?: string;
}

interface BatchResult {
  successful: number;
  failed: number;
  ids: string[];
  errors: BatchError[];
}

/** The entry service, for the batch writes the plugin facade does not offer. */
function entryService(): Record<
  string,
  (...args: unknown[]) => Promise<BatchResult>
> {
  return (
    t().getService("collectionsHandler") as unknown as {
      getEntryService(): Record<
        string,
        (...args: unknown[]) => Promise<BatchResult>
      >;
    }
  ).getEntryService();
}

/**
 * Boot with one collection holding two entries, and hand back the plugin's
 * services and the entries' ids.
 */
async function boot(
  dialect: TestDialect
): Promise<{ services: Services; ids: string[] }> {
  let services: Services | undefined;
  const probe = definePlugin({
    name: "@test/legacy-batch-not-migrated",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init: ctx => {
      services = ctx.services;
    },
  });
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        hooks: {
          // An item whose write reaches another collection the database
          // lacks, as a hook reading it would, fails with that collection's
          // answer: a fact about the other collection, not this one.
          beforeChange: [
            ({ data }: { data?: Record<string, unknown> }) => {
              if (data?.title === FOREIGN_TITLE) {
                throw NextlyError.notMigrated({
                  kind: "collection",
                  slug: "lb_authors",
                  reason: "table",
                });
              }
              return data;
            },
          ],
        },
        access: {
          read: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
        fields: [text({ name: "title" }), text({ name: "subtitle" })],
      }),
    ],
    plugins: [probe],
    seedPublic: true,
  });
  // The entry service's batches take no `overrideAccess`; written with no
  // user, they are judged as a visitor, whom Public lets write.
  await grantPublic(
    t(),
    ["create", "read", "update", "delete"].map(op => `${op}-${POSTS}`)
  );
  if (!services) throw new Error("the plugin's init never ran");
  const ids: string[] = [];
  for (const title of ["First", "Second"]) {
    const created = await t().nextly.create({
      collection: POSTS,
      data: { title, subtitle: "One" },
    });
    ids.push((created.item as { id: string }).id);
  }
  return { services, ids };
}

function quoted(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

async function execute(sql: string): Promise<unknown> {
  return (
    t().adapter as unknown as { executeQuery(sql: string): Promise<unknown> }
  ).executeQuery(sql);
}

async function takeAway(
  dialect: TestDialect,
  reason: "column" | "table"
): Promise<void> {
  await execute(
    reason === "column"
      ? `ALTER TABLE ${quoted(dialect, POSTS_TABLE)} DROP COLUMN ${quoted(dialect, "subtitle")}`
      : `DROP TABLE ${quoted(dialect, POSTS_TABLE)}`
  );
}

/** How many rows the collection's table holds, read with raw SQL. */
async function rowCount(dialect: TestDialect): Promise<number> {
  const rows = (await execute(
    `SELECT COUNT(*) AS n FROM ${quoted(dialect, POSTS_TABLE)}`
  )) as Array<{ n: number | string }>;
  return Number(rows[0]?.n);
}

/** Every failed item reports ENTITY_NOT_MIGRATED, by index, with a message. */
function expectEveryItemNotMigrated(
  result: BatchResult,
  count: number,
  label: string
): void {
  expect(result.successful, `${label}: nothing succeeds`).toBe(0);
  expect(result.failed, `${label}: every item fails`).toBe(count);
  expect(
    result.errors.map(e => e.index),
    `${label}: one error per item, by index`
  ).toEqual(Array.from({ length: count }, (_, i) => i));
  for (const e of result.errors) {
    expect
      .soft(e.code, `${label}: item ${e.index} reports its own code`)
      .toBe("ENTITY_NOT_MIGRATED");
    // The item's own not-migrated message, which names the remedy, rather
    // than a rollback's generic text.
    expect
      .soft(e.error, `${label}: item ${e.index} keeps its own message`)
      .toMatch(/nextly migrate/);
  }
}

/** What a write answered with when it threw a typed error. */
async function rejection(
  work: () => Promise<unknown>
): Promise<{ code: string; status: number } | "resolved"> {
  try {
    await work();
    return "resolved";
  } catch (error) {
    if (!NextlyError.is(error)) throw error;
    return { code: String(error.code), status: error.statusCode };
  }
}

describe.each(getConfiguredTestDialects())(
  "a legacy batch write the database is not migrated for (%s)",
  dialect => {
    it.each([
      ["a declared field's column", "column"],
      ["the collection's table", "table"],
    ] as const)(
      "createMany reports ENTITY_NOT_MIGRATED on every item when %s is missing",
      async (_what, reason) => {
        const { services } = await boot(dialect);
        await takeAway(dialect, reason);

        const result = (await services.collections.createMany(
          POSTS,
          [
            { title: "Third", subtitle: "Three" },
            { title: "Fourth", subtitle: "Four" },
          ],
          { as: "system" }
        )) as BatchResult;

        expectEveryItemNotMigrated(result, 2, "createMany");
        expect(result.ids).toEqual([]);
        // The table is still there when only a column went; nothing was added.
        if (reason === "column") expect(await rowCount(dialect)).toBe(2);
      },
      120_000
    );

    it("fails only the item whose write reaches another collection not migrated", async () => {
      // The batch's own collection is migrated: an answer about a different
      // one is that item's failure alone, and the rest of the batch commits.
      const { services } = await boot(dialect);
      const result = (await services.collections.createMany(
        POSTS,
        [{ title: FOREIGN_TITLE }, { title: "Fifth", subtitle: "Five" }],
        { as: "system" }
      )) as BatchResult;

      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors).toEqual([
        expect.objectContaining({ index: 0, code: "ENTITY_NOT_MIGRATED" }),
      ]);
      expect(await rowCount(dialect)).toBe(3);
    }, 120_000);

    it("rolls a mixed batch back whole at its first not-migrated item, without stopOnError", async () => {
      // The first item names no column the database lacks, so on its own it
      // would be written; the second names the dropped one. A collection the
      // database is not migrated for is refused as a whole, on every dialect:
      // nothing commits, and each item reports why.
      const { services } = await boot(dialect);
      await takeAway(dialect, "column");

      const result = (await services.collections.createMany(
        POSTS,
        [{ title: "Third" }, { title: "Fourth", subtitle: "Four" }],
        { as: "system" }
      )) as BatchResult;

      expectEveryItemNotMigrated(result, 2, "mixed createMany");
      expect(result.ids).toEqual([]);
      expect(await rowCount(dialect)).toBe(2);
    }, 120_000);

    it.each([
      ["a declared field's column", "column"],
      ["the collection's table", "table"],
    ] as const)(
      "updateMany reports ENTITY_NOT_MIGRATED on every item when %s is missing",
      async (_what, reason) => {
        const { services, ids } = await boot(dialect);
        await takeAway(dialect, reason);

        const result = (await services.collections.updateMany(
          POSTS,
          ids.map(id => ({ id, data: { subtitle: "Uno", _overwrite: true } })),
          { as: "system" }
        )) as BatchResult;

        expectEveryItemNotMigrated(result, 2, "updateMany");
        expect(result.ids).toEqual([]);
      },
      120_000
    );

    it.each([
      ["a declared field's column", "column"],
      ["the collection's table", "table"],
    ] as const)(
      "deleteEntries reports ENTITY_NOT_MIGRATED on every item when %s is missing",
      async (_what, reason) => {
        const { ids } = await boot(dialect);
        await takeAway(dialect, reason);

        const result = await entryService().deleteEntries(
          { collectionName: POSTS },
          ids
        );

        expectEveryItemNotMigrated(result, 2, "deleteEntries");
        if (reason === "column") expect(await rowCount(dialect)).toBe(2);
      },
      120_000
    );

    it.each([
      ["a declared field's column", "column", true],
      ["the collection's table", "table", true],
      // Without stopOnError too: no later item can be written, and on
      // PostgreSQL the caller's transaction is already aborted, so the batch
      // stops at the first answer rather than running the rest into it.
      ["a declared field's column", "column", false],
      ["the collection's table", "table", false],
    ] as const)(
      "createEntriesInTransaction answers ENTITY_NOT_MIGRATED 409 in a caller's transaction when %s is missing (%s, stopOnError %s)",
      async (_what, reason, stopOnError) => {
        await boot(dialect);
        await takeAway(dialect, reason);

        const answer = await rejection(() =>
          t().adapter.transaction(tx =>
            entryService().createEntriesInTransaction(
              tx,
              { collectionName: POSTS },
              [
                { title: "Third", subtitle: "Three" },
                { title: "Fourth", subtitle: "Four" },
              ],
              { stopOnError }
            )
          )
        );

        expect(answer).toEqual({ code: "ENTITY_NOT_MIGRATED", status: 409 });
        if (reason === "column") expect(await rowCount(dialect)).toBe(2);
      },
      120_000
    );

    it("reports a not-found item by its own code beside a written item", async () => {
      const { services, ids } = await boot(dialect);

      const result = (await services.collections.updateMany(
        POSTS,
        // The second item names no row.
        [
          { id: ids[0], data: { subtitle: "Uno", _overwrite: true } },
          { id: "lb-missing-id", data: { subtitle: "Dos", _overwrite: true } },
        ],
        { as: "system" }
      )) as BatchResult;

      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ index: 1, code: "NOT_FOUND" });
    }, 120_000);

    it("throws the failed item's own error from a stopOnError twin on a healthy table", async () => {
      const { ids } = await boot(dialect);

      const answer = await rejection(() =>
        t().adapter.transaction(tx =>
          entryService().updateEntriesInTransaction(
            tx,
            { collectionName: POSTS },
            [
              { id: ids[0], data: { subtitle: "Uno", _overwrite: true } },
              {
                id: "lb-missing-id",
                data: { subtitle: "Dos", _overwrite: true },
              },
            ],
            { stopOnError: true }
          )
        )
      );

      expect(answer).toEqual({ code: "NOT_FOUND", status: 404 });
    }, 120_000);
  }
);
