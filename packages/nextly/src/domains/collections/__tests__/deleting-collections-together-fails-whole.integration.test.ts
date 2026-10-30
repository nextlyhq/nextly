/**
 * A Builder delete of several collections that fails part-way removes none of
 * them: not the earlier collections' field-group values or translations, not
 * a table, not a registry row, and no drop migration is left for a deploy to
 * apply.
 *
 * The failure is injected into the database statement that tears down the
 * second collection's translations, after the first collection's teardown has
 * run, and, in development, into the drop of the second collection's table,
 * after every teardown has run. PostgreSQL and SQLite undo all of it. MySQL
 * commits each table drop as it runs, so there the delete keeps every
 * collection registered, says what may already be gone, and a second delete
 * finishes it.
 *
 * Each case ends with the delete run again without the failure, which must
 * write its drop migration and remove both collections: the check that no
 * drop migration was left is then not satisfied merely by where it looks.
 *
 * @module domains/collections/__tests__/deleting-collections-together-fails-whole.integration.test
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, expect, it, vi } from "vitest";

import { defineCollection, fieldGroup, text } from "../../../config";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { NextlyError } from "../../../errors/nextly-error";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { CollectionFileManager } from "../../../services/collection-file-manager";
import { clearCollectionRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { resolveComponentTableName } from "../../schema/utils/resolve-table-name";
import type { CollectionRegistryService } from "../services/collection-registry-service";

import {
  META,
  TAGS,
  TAGS_TABLE,
  metaGroup,
  tags,
} from "./helpers/collection-dependents-fixtures";

/** A second translated collection with field-group values, deleted with TAGS. */
const NOTES = "dep_notes";
const NOTES_TABLE = `dc_${NOTES}`;
const notes = defineCollection({
  slug: NOTES,
  localized: true,
  fields: [
    text({ name: "label" }),
    fieldGroup({ name: "meta", component: META }),
  ],
});

/** Where the harness writes the Builder's drop migrations (gitignored). */
const DROP_MIGRATIONS_DIR = path.resolve("src/db/migrations/dynamic");

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await current?.destroy();
  current = undefined;
});

const registryOf = (t: TestNextly) =>
  t.getService("collectionRegistryService") as CollectionRegistryService;

/** Boot with TAGS and NOTES, translated, one entry each with a field-group value, both as the Builder leaves them. */
async function bootPair(dialect: TestDialect): Promise<TestNextly> {
  const t = await createTestNextly({
    dialect,
    collections: [tags, notes],
    fieldGroups: [metaGroup],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  for (const collection of [TAGS, NOTES]) {
    await t.nextly.create({
      collection,
      data: { label: "kept", meta: { note: "n" } },
    });
  }
  // Code-first rows are locked; the Builder's delete reaches only unlocked ones.
  await t.adapter.update(
    "dynamic_collections",
    { locked: 0 },
    { and: [{ column: "slug", op: "IN", value: [TAGS, NOTES] }] }
  );
  clearCollectionRowCache();
  current = t;
  return t;
}

/** What a collection holds: its table, rows, translations, field-group values and registry row. */
async function stateOf(t: TestNextly, slug: string, table: string) {
  const q = (name: string) =>
    t.adapter.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const count = async (sql: string) =>
    Number(
      (await t.adapter.executeQuery<{ n: unknown }>(sql))[0]?.n ?? Number.NaN
    );
  const companion = `${table}_locales`;
  return {
    table: await t.adapter.tableExists(table),
    rows: (await t.adapter.tableExists(table))
      ? await count(`SELECT COUNT(*) AS n FROM ${q(table)}`)
      : 0,
    translations: (await t.adapter.tableExists(companion))
      ? await count(`SELECT COUNT(*) AS n FROM ${q(companion)}`)
      : 0,
    fieldGroupValues: await count(
      `SELECT COUNT(*) AS n FROM ${q(resolveComponentTableName(META))} WHERE ${q("_parent_table")} = '${table}'`
    ),
    registry: (await registryOf(t).getCollectionBySlug(slug)) !== null,
  };
}

const INTACT = {
  table: true,
  rows: 1,
  translations: 1,
  fieldGroupValues: 1,
  registry: true,
};

/**
 * Fail every statement matching `pattern`, however it reaches the database:
 * on the adapter, on a transaction, or inside a whole migration the file
 * manager runs. The delete is then failed at that statement wherever it runs
 * it. Returns how many statements it failed.
 */
function failStatements(t: TestNextly, pattern: RegExp): () => number {
  let failed = 0;
  const refuse = (statement: string) => {
    if (!pattern.test(statement)) return;
    failed += 1;
    throw new Error(`injected failure: ${statement}`);
  };
  const runMigration = CollectionFileManager.prototype.runMigration;
  vi.spyOn(CollectionFileManager.prototype, "runMigration").mockImplementation(
    async function (this: CollectionFileManager, migrationSQL: string) {
      // Statements are separated by breakpoints and each ends its own line.
      for (const line of migrationSQL.split("\n")) refuse(line.trim());
      return runMigration.call(this, migrationSQL);
    }
  );
  const adapter = t.adapter;
  const executeQuery = adapter.executeQuery.bind(adapter);
  vi.spyOn(adapter, "executeQuery").mockImplementation(
    async (statement, params) => {
      refuse(statement);
      return executeQuery(statement, params);
    }
  );
  const transaction = adapter.transaction.bind(adapter);
  vi.spyOn(adapter, "transaction").mockImplementation((work, options) =>
    transaction(
      tx =>
        work(
          new Proxy(tx, {
            get(target, key) {
              if (key === "execute") {
                return async (
                  statement: string,
                  params?: Parameters<TransactionContext["execute"]>[1]
                ) => {
                  refuse(statement);
                  return target.execute(statement, params);
                };
              }
              const value: unknown = Reflect.get(target, key);
              return typeof value === "function" ? value.bind(target) : value;
            },
          })
        ),
      options
    )
  );
  return () => failed;
}

/** A DROP of exactly `table` (not its companion): quoted, then the statement's end. */
function dropOf(table: string): RegExp {
  return new RegExp(
    `DROP TABLE IF EXISTS [\`"]${table}[\`"](\\s+CASCADE)?;?\\s*$`
  );
}

/** The Builder's delete of several collections at once, through the dispatcher. */
function builderBulkDelete(slugs: readonly string[]): Promise<unknown> {
  return dispatchCollections(
    {} as ServiceContainer,
    "deleteCollection",
    { collectionName: slugs[0], together: slugs.slice(1).join(",") },
    undefined
  );
}

/** What the delete rejected with. */
async function failureOf(attempt: Promise<unknown>): Promise<NextlyError> {
  const outcome = await attempt.then(
    () => undefined,
    (error: unknown) => error
  );
  if (!NextlyError.is(outcome)) {
    throw new Error(`expected a NextlyError, got ${String(outcome)}`);
  }
  return outcome;
}

/** Drop migrations written since `since` that name `table`. */
function dropMigrationsNaming(table: string, since: number): string[] {
  return readdirSync(DROP_MIGRATIONS_DIR).filter(name => {
    const stamp = Number(name.split("_")[0]);
    if (!(stamp >= since)) return false;
    return readFileSync(path.join(DROP_MIGRATIONS_DIR, name), "utf8").includes(
      table
    );
  });
}

describeEachDialect("deleting collections together fails whole", dialect => {
  /** After the failed delete: nothing removed, or on MySQL every collection still registered. */
  async function expectNothingRemoved(t: TestNextly, since: number) {
    if (dialect === "mysql") {
      // Each table drop commits as it runs: what was dropped stays dropped,
      // and the registry rows, removed last, are what keep the delete
      // repeatable.
      expect((await stateOf(t, TAGS, TAGS_TABLE)).registry).toBe(true);
      expect((await stateOf(t, NOTES, NOTES_TABLE)).registry).toBe(true);
      return;
    }
    expect(await stateOf(t, TAGS, TAGS_TABLE)).toEqual(INTACT);
    expect(await stateOf(t, NOTES, NOTES_TABLE)).toEqual(INTACT);
    expect(dropMigrationsNaming(NOTES_TABLE, since)).toEqual([]);
  }

  /** The delete run again without the failure: it writes its drop migration and removes both. */
  async function expectDeletingAgainFinishes(
    t: TestNextly,
    since: number,
    development: boolean
  ) {
    if (development) vi.stubEnv("NODE_ENV", "development");
    await builderBulkDelete([TAGS, NOTES]);
    vi.unstubAllEnvs();
    expect(dropMigrationsNaming(NOTES_TABLE, since).length).toBeGreaterThan(0);
    for (const [slug, table] of [
      [TAGS, TAGS_TABLE],
      [NOTES, NOTES_TABLE],
    ] as const) {
      expect(await stateOf(t, slug, table)).toEqual(
        development
          ? {
              table: false,
              rows: 0,
              translations: 0,
              fieldGroupValues: 0,
              registry: false,
            }
          : // Outside development the table drop is written, not run.
            {
              table: true,
              rows: 1,
              translations: 0,
              fieldGroupValues: 0,
              registry: false,
            }
      );
    }
  }

  function expectTheFailureSays(failure: NextlyError) {
    expect(failure.statusCode).toBe(500);
    expect(failure.publicMessage).toBe(
      dialect === "mysql"
        ? "Deleting these collections failed part-way. MySQL keeps each table drop as it runs, so some of what they stored, such as field-group values and translations, may already be removed. Delete those still listed again to finish."
        : "Deleting these collections failed, so nothing was removed."
    );
  }

  it("keeps both collections whole when tearing down the second one's translations fails", async () => {
    const t = await bootPair(dialect);
    const since = Date.now();
    const failed = failStatements(t, dropOf(`${NOTES_TABLE}_locales`));

    const failure = await failureOf(builderBulkDelete([TAGS, NOTES]));
    vi.restoreAllMocks();

    expect(failed()).toBe(1);
    await expectNothingRemoved(t, since);
    expectTheFailureSays(failure);
    await expectDeletingAgainFinishes(t, since, false);
  }, 120_000);

  it("keeps both collections whole when, in development, dropping the second one's table fails", async () => {
    const t = await bootPair(dialect);
    const since = Date.now();
    const failed = failStatements(t, dropOf(NOTES_TABLE));

    vi.stubEnv("NODE_ENV", "development");
    const failure = await failureOf(builderBulkDelete([TAGS, NOTES]));
    vi.unstubAllEnvs();
    vi.restoreAllMocks();

    expect(failed()).toBe(1);
    await expectNothingRemoved(t, since);
    expectTheFailureSays(failure);
    await expectDeletingAgainFinishes(t, since, true);
  }, 120_000);
});
