/**
 * A required field moved out of a group by a Schema Builder save that also changes its table in a
 * way SQLite makes by rebuilding it (a relation added, another field made required) keeps every
 * value and ends required, on every configured dialect.
 *
 * The move adds its column nullable, fills it from the group, then makes it required. On SQLite the
 * same save's rebuild recreates the table to the shape the file leaves it in, and copies the rows
 * across before the fill: the rebuilt table holds the moved column nullable until the fill is in,
 * as the column's own add does. PostgreSQL and MySQL alter the table in place, and are run as the
 * same saves' controls.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  downDatabaseDeps,
  migrateDownCore,
} from "../../../../cli/commands/migrate-down";
import { createLogger } from "../../../../cli/utils/logger";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import type { CollectionService } from "../../../collections/services/collection-service";
import { clearRegistryRowCache } from "../../../dynamic-collections/services/collection-row-cache";
import { readTableDefinition } from "../../__tests__/helpers/table-definition";
import { resolveDataLossConsent } from "../../migrate/data-loss-consent";
import { marksNoTransaction } from "../../migrate/split-sql";
import { parseSqlSections } from "../../migrate/sql-sections";
import { withMigrateLock } from "../../pipeline/locks";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const SLUG = "rmr_posts";
const TABLE = "dc_rmr_posts";
const AUTHORS = "rmr_authors";

type Field = Record<string, unknown>;

const group = (name: string, fields: Field[]): Field => ({
  name,
  type: "group",
  fields,
});
const NOTE: Field = { name: "note", type: "text" };
const SUMMARY: Field = { name: "summary", type: "text", required: true };
const subtitle = (required = false): Field => ({
  name: "subtitle",
  type: "text",
  ...(required ? { required: true } : {}),
});
const AUTHOR: Field = {
  name: "author",
  type: "relationship",
  relationTo: AUTHORS,
};
const OUT = [{ from: ["meta", "summary"], to: ["summary"] }];

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-required-move-rebuild-"));
  // The schema dialog applies its change, and writes its migration, in development only.
  vi.stubEnv("NODE_ENV", "development");
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

const run = <T>(t: TestNextly, statement: string) =>
  (t.adapter as unknown as DrizzleAdapter).executeQuery(
    statement
  ) as unknown as Promise<T[]>;

async function createCollection(
  t: TestNextly,
  slug: string,
  fields: Field[]
): Promise<void> {
  await t.getService("collectionService").createCollection(
    {
      name: slug,
      label: slug,
      localized: false,
      fields,
    } as Parameters<CollectionService["createCollection"]>[0],
    {}
  );
}

async function versionOf(t: TestNextly): Promise<number> {
  const [row] = await run<{ version: number | string | null }>(
    t,
    `SELECT schema_version AS version FROM dynamic_collections WHERE slug = '${SLUG}'`
  );
  return Number(row?.version ?? 1);
}

/**
 * The schema dialog's save of `fields`, with the moves the Builder sends beside them (the move out
 * of the group unless given) and the answers the person gave.
 */
async function save(
  t: TestNextly,
  fields: Field[],
  options: {
    moves?: { from: string[]; to: string[] }[];
    eventResolutions?: Record<string, unknown>[];
  } = {}
): Promise<void> {
  await dispatchCollections(
    {} as ServiceContainer,
    "applySchemaChanges",
    { collectionName: SLUG },
    {
      fields,
      confirmed: true,
      schemaVersion: await versionOf(t),
      hints: { moves: options.moves ?? OUT },
      ...(options.eventResolutions === undefined
        ? {}
        : { eventResolutions: options.eventResolutions }),
    }
  );
  clearRegistryRowCache();
}

/**
 * `nextly migrate:down` of the newest migration on `t`'s database, or of the newest `step`, reading
 * the files the saves wrote.
 */
async function migrateDown(t: TestNextly, step = 1): Promise<void> {
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
      step,
      consent: resolveDataLossConsent({ flag: true, env: {} }),
      yes: true,
      dryRun: false,
    },
    fileExists: () => Promise.resolve(true),
    readDownSql: async filename => {
      const name = filename.endsWith(".sql") ? filename : `${filename}.sql`;
      const content = await readFile(join(migrationsDir, name), "utf-8");
      return {
        sql: parseSqlSections(content).downSql,
        transaction: !marksNoTransaction(content),
      };
    },
    withLock: withMigrateLock,
  } as Parameters<typeof migrateDownCore>[0]);
  clearRegistryRowCache();
}

describe.each(getConfiguredTestDialects())(
  "a required field moved out of a group beside a change SQLite rebuilds the table for (%s)",
  dialect => {
    const q = (id: string) => (dialect === "mysql" ? `\`${id}\`` : `"${id}"`);
    const definition = (t: TestNextly) =>
      readTableDefinition(statement => run(t, statement), dialect, TABLE);
    const nullable = async (t: TestNextly, column: string) =>
      (await definition(t)).columns.find(c => c.name === column)?.nullable;

    /** Two entries, each holding the group's summary and a subtitle. */
    async function seed(
      t: TestNextly,
      fields: Field[],
      summary: Field = SUMMARY
    ): Promise<void> {
      await createCollection(t, SLUG, [
        ...fields,
        group("meta", [NOTE, summary]),
      ]);
      for (const [title, text] of [
        ["One", "First"],
        ["Two", "Second"],
      ] as const) {
        await t.nextly.create({
          collection: SLUG,
          data: {
            title,
            slug: title.toLowerCase(),
            subtitle: `${title} sub`,
            meta: { summary: text },
          },
        });
      }
    }

    /** Each entry's summary on the row, and the group's, as the database holds them. */
    async function stored(t: TestNextly): Promise<unknown[]> {
      const rows = await run<{ summary: unknown; meta: unknown }>(
        t,
        `SELECT ${q("summary")} AS summary, ${q("meta")} AS meta FROM ${q(TABLE)} ORDER BY ${q("slug")}`
      );
      return rows.map(row => ({
        summary: row.summary,
        meta: typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta,
      }));
    }
    const MOVED = [
      { summary: "First", meta: {} },
      { summary: "Second", meta: {} },
    ];

    it("keeps every value where the same save adds a relation, its key and the column required", async () => {
      const t = await boot(dialect);
      await createCollection(t, AUTHORS, [{ name: "name", type: "text" }]);
      await seed(t, [subtitle()]);

      await save(t, [subtitle(), AUTHOR, SUMMARY, group("meta", [NOTE])]);

      expect(await stored(t)).toEqual(MOVED);
      expect(await nullable(t, "summary")).toBe(false);
      expect(
        (await definition(t)).foreignKeys.map(key => key.columns)
      ).toContainEqual(["author"]);
    });

    it("keeps every value where the same save makes another field required, both columns required", async () => {
      const t = await boot(dialect);
      await seed(t, [subtitle()]);

      await save(t, [subtitle(true), SUMMARY, group("meta", [NOTE])]);

      expect(await stored(t)).toEqual(MOVED);
      expect(await nullable(t, "summary")).toBe(false);
      expect(await nullable(t, "subtitle")).toBe(false);
    });

    it("keeps every value where the same save makes another field required, filling the entries it holds no value for", async () => {
      const t = await boot(dialect);
      await seed(t, [subtitle()]);
      await run(
        t,
        `UPDATE ${q(TABLE)} SET ${q("subtitle")} = NULL WHERE ${q("slug")} = 'two'`
      );

      await save(t, [subtitle(true), SUMMARY, group("meta", [NOTE])], {
        eventResolutions: [
          {
            kind: "provide_default",
            eventId: `add_not_null_with_nulls:${TABLE}.subtitle`,
            value: "Filled",
          },
        ],
      });

      expect(await stored(t)).toEqual(MOVED);
      const subtitles = await run<{ subtitle: string }>(
        t,
        `SELECT ${q("subtitle")} AS subtitle FROM ${q(TABLE)} ORDER BY ${q("slug")}`
      );
      expect(subtitles.map(row => row.subtitle)).toEqual(["One sub", "Filled"]);
      expect(await nullable(t, "summary")).toBe(false);
      expect(await nullable(t, "subtitle")).toBe(false);
    });

    it("undoes a required field's move into a group beside a relation added with nextly migrate:down, its column required again with every value", async () => {
      const t = await boot(dialect);
      await createCollection(t, AUTHORS, [{ name: "name", type: "text" }]);
      await createCollection(t, SLUG, [SUMMARY, group("meta", [NOTE])]);
      for (const [title, text] of [
        ["One", "First"],
        ["Two", "Second"],
      ] as const) {
        await t.nextly.create({
          collection: SLUG,
          data: { title, slug: title.toLowerCase(), summary: text },
        });
      }
      await save(t, [AUTHOR, group("meta", [NOTE, SUMMARY])], {
        moves: [{ from: ["summary"], to: ["meta", "summary"] }],
      });

      // On MySQL the save wrote two files, the moves' own and the one that drops the column they left.
      await migrateDown(t, dialect === "mysql" ? 2 : 1);

      const rows = await run<{ summary: string }>(
        t,
        `SELECT ${q("summary")} AS summary FROM ${q(TABLE)} ORDER BY ${q("slug")}`
      );
      expect(rows.map(row => row.summary)).toEqual(["First", "Second"]);
      expect(await nullable(t, "summary")).toBe(false);
      expect((await definition(t)).columns.map(c => c.name)).not.toContain(
        "author"
      );
    });

    it("is still refused, nothing changed, where an entry holds no value to move", async () => {
      const t = await boot(dialect);
      await seed(t, [subtitle()]);
      await run(
        t,
        `UPDATE ${q(TABLE)} SET ${q("meta")} = '{}' WHERE ${q("slug")} = 'two'`
      );
      const before = await definition(t);

      await expect(
        save(t, [subtitle(true), SUMMARY, group("meta", [NOTE])])
      ).rejects.toThrow(
        expect.objectContaining({
          publicData: {
            errors: [expect.objectContaining({ code: "FIELD_MOVE_REFUSED" })],
          },
        })
      );

      expect(await definition(t)).toEqual(before);
    });

    it("keeps every value where the table already has a relation and the save only moves", async () => {
      const t = await boot(dialect);
      await createCollection(t, AUTHORS, [{ name: "name", type: "text" }]);
      await seed(t, [subtitle(), AUTHOR]);

      await save(t, [subtitle(), AUTHOR, SUMMARY, group("meta", [NOTE])]);

      expect(await stored(t)).toEqual(MOVED);
      expect(await nullable(t, "summary")).toBe(false);
    });

    it("keeps an optional field's values, its column optional, where the same save makes another field required", async () => {
      const t = await boot(dialect);
      const optional: Field = { name: "summary", type: "text" };
      await seed(t, [subtitle()], optional);

      await save(t, [subtitle(true), optional, group("meta", [NOTE])]);

      expect(await stored(t)).toEqual(MOVED);
      expect(await nullable(t, "summary")).toBe(true);
      expect(await nullable(t, "subtitle")).toBe(false);
    });
  }
);
