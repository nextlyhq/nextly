/**
 * A field the Schema Builder moves into a group, or out of one, keeps every entry's value: the
 * save writes the copy into its migration file beside the column it adds or drops, and runs it.
 * Proved on the two roads a person takes, on every configured dialect:
 *
 * - the Builder's schema dialog on a development database, each entry read back through the API
 *   and compared with an entry written into the new place directly, so the moved value reads as
 *   one the API stored itself would;
 * - `nextly migrate` replaying the files the dialog wrote into a second database, a deploy's,
 *   whose group column holds what the first database's held, and whose entries read the same.
 *
 * What the moved column had that a group's JSON value has no place for (its type, NOT NULL, index,
 * comment, character set and collation) is named in the review and in the file's header, and
 * applied to no other column.
 *
 * A move the save cannot keep the values of is refused before anything is written or run: the
 * definition, the migration files, the table and every entry stand as they were.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore } from "../../../../cli/commands/migrate";
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
import {
  type DataLossConsent,
  NO_CONSENT,
  resolveDataLossConsent,
} from "../../migrate/data-loss-consent";
import { marksNoTransaction } from "../../migrate/split-sql";
import { parseSqlSections } from "../../migrate/sql-sections";
import { withMigrateLock } from "../../pipeline/locks";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };
const SLUG = "gmv_posts";
const TABLE = "dc_gmv_posts";

type Field = Record<string, unknown>;

/** One field of each kind whose value a move carries as a different JSON value. */
const MOVED = ["summary", "views", "featured", "published"] as const;
const MOVED_FIELDS: Field[] = [
  { name: "summary", type: "text" },
  { name: "views", type: "number" },
  { name: "featured", type: "checkbox" },
  { name: "published", type: "date" },
];
const NOTE: Field = { name: "note", type: "text" };
const group = (name: string, fields: Field[]): Field => ({
  name,
  type: "group",
  fields,
});

/** The fields on the row, the group beside them. */
const OUTSIDE: Field[] = [...MOVED_FIELDS, group("meta", [NOTE])];
/** The same fields, moved into the group. */
const INSIDE: Field[] = [group("meta", [NOTE, ...MOVED_FIELDS])];
const INTO = MOVED.map(name => ({ from: [name], to: ["meta", name] }));
const OUT = MOVED.map(name => ({ from: ["meta", name], to: [name] }));

/** Entries holding each kind of value, an empty one and characters JSON escapes among them. */
const ENTRIES = [
  {
    title: "One",
    slug: "one",
    summary: "First",
    views: 7,
    featured: true,
    published: "2026-01-02T03:04:05.000Z",
  },
  { title: "Two", slug: "two", views: 0, featured: false },
  {
    title: "Three",
    slug: "three",
    summary: 'He said "hi" \\ — ü',
    views: -3,
    featured: true,
    published: "1999-12-31T23:59:59.000Z",
  },
];

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-group-moves-"));
  // The schema dialog applies its change, and writes its migration, in development only.
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  // The rest of the teardown runs even where the instance's own fails, which is still reported.
  try {
    await instance?.destroy();
  } finally {
    instance = undefined;
    vi.unstubAllEnvs();
    await rm(basePath, { recursive: true, force: true });
  }
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  instance = await createTestNextly({
    dialect,
    basePath,
    db: DB,
    localization: LOCALIZATION,
  });
  return instance;
}

const run = <T>(t: TestNextly, statement: string) =>
  (t.adapter as unknown as DrizzleAdapter).executeQuery(
    statement
  ) as unknown as Promise<T[]>;

/** The collection as the Builder creates it, its fields on the row. */
async function createPosts(
  t: TestNextly,
  slug = SLUG,
  options: { fields?: Field[]; localized?: boolean; hooks?: Field[] } = {}
): Promise<void> {
  await t.getService("collectionService").createCollection(
    {
      name: slug,
      label: "Post",
      localized: options.localized ?? false,
      fields: options.fields ?? OUTSIDE,
      ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
    } as Parameters<CollectionService["createCollection"]>[0],
    {}
  );
}

async function versionOf(t: TestNextly, slug: string): Promise<number> {
  const [row] = await run<{ version: number | string | null }>(
    t,
    `SELECT schema_version AS version FROM dynamic_collections WHERE slug = '${slug}'`
  );
  return Number(row?.version ?? 1);
}

/** The schema dialog's save of `fields`, with the moves the Builder sends beside them. */
async function save(
  t: TestNextly,
  fields: Field[],
  moves: { from: string[]; to: string[] }[],
  slug = SLUG
): Promise<void> {
  await dispatchCollections(
    {} as ServiceContainer,
    "applySchemaChanges",
    { collectionName: slug },
    {
      fields,
      confirmed: true,
      schemaVersion: await versionOf(t, slug),
      hints: { moves },
    }
  );
  clearRegistryRowCache();
}

/** The dialog's review of the same save, before the person confirms it. */
async function preview(
  fields: Field[],
  moves: { from: string[]; to: string[] }[],
  slug = SLUG
): Promise<unknown> {
  return dispatchCollections(
    {} as ServiceContainer,
    "previewSchemaChanges",
    { collectionName: slug },
    { fields, hints: { moves } }
  );
}

async function seed(t: TestNextly): Promise<void> {
  for (const data of ENTRIES) {
    await t.nextly.create({ collection: SLUG, data });
  }
}

type Item = Record<string, unknown> & { slug: string };

/** Every entry, read through the API, by slug. */
async function readAll(t: TestNextly): Promise<Map<string, Item>> {
  const { items } = await t.nextly.find({ collection: SLUG, limit: 100 });
  return new Map(
    (items as Item[]).map(item => [item.slug, item] as [string, Item])
  );
}

/** The moved fields' values in `holder`, an absent value read as null. */
function movedValues(holder: unknown): Record<string, unknown> {
  const values = (holder ?? {}) as Record<string, unknown>;
  return Object.fromEntries(MOVED.map(name => [name, values[name] ?? null]));
}

/**
 * The same values as JSON holds them: a group's date reads back as the text of its instant, where
 * the date's own column reads back as a date.
 */
const asJson = (values: Record<string, unknown>): unknown =>
  JSON.parse(JSON.stringify(values));

/** The posts' registry row as stored, whole, which a refused save leaves as it was. */
async function registryRow(t: TestNextly, slug = SLUG): Promise<string> {
  const [row] = await run<Record<string, unknown>>(
    t,
    `SELECT * FROM dynamic_collections WHERE slug = '${slug}'`
  );
  return JSON.stringify(row ?? null, Object.keys(row ?? {}).sort());
}

/** How many migration files the saves have written so far. */
async function filesWritten(): Promise<number> {
  return (await readdir(join(basePath, "migrations"))).filter(f =>
    f.endsWith(".sql")
  ).length;
}

/** Each migration file the saves have written, by name, with what it holds. */
async function migrationFiles(): Promise<Record<string, string>> {
  const folder = join(basePath, "migrations");
  const names = (await readdir(folder)).filter(f => f.endsWith(".sql")).sort();
  return Object.fromEntries(
    await Promise.all(
      names.map(async name => [
        name,
        await readFile(join(folder, name), "utf-8"),
      ])
    )
  );
}

const definition = () => readFile(join(basePath, "ui-schema.json"), "utf-8");

/** `nextly migrate` on `t`'s database over the folder the first database wrote. */
async function migrateFolder(
  t: TestNextly,
  step?: number,
  consent: DataLossConsent = NO_CONSENT
): Promise<void> {
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
    consent,
    interactive: false,
  } as never);
  clearRegistryRowCache();
}

/** The newest migration file the saves wrote. */
async function newestFile(): Promise<string> {
  const files = (await readdir(join(basePath, "migrations")))
    .filter(f => f.endsWith(".sql"))
    .sort();
  return readFile(join(basePath, "migrations", files.at(-1) ?? ""), "utf-8");
}

/** `nextly migrate:down` of the newest migration on `t`'s database, reading the files the saves wrote. */
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
  "a field moved into or out of a group keeps every value (%s)",
  dialect => {
    const q = (id: string) => (dialect === "mysql" ? `\`${id}\`` : `"${id}"`);

    async function columnsOf(t: TestNextly, table = TABLE): Promise<string[]> {
      const rows = await run<{ name: string }>(
        t,
        dialect === "mysql"
          ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
          : dialect === "sqlite"
            ? `SELECT name FROM pragma_table_info('${table}')`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
      );
      return rows.map(row => row.name);
    }

    /** The group column of each entry as the database holds it, parsed, by slug. */
    async function storedGroups(
      t: TestNextly
    ): Promise<Record<string, unknown>> {
      const rows = await run<{ slug: string; meta: unknown }>(
        t,
        `SELECT ${q("slug")} AS slug, ${q("meta")} AS meta FROM ${q(TABLE)} ORDER BY ${q("slug")}`
      );
      return Object.fromEntries(
        rows.map(row => [
          row.slug,
          typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta,
        ])
      );
    }

    /**
     * Each entry's values in the group, read as an entry written into the group directly with the
     * values read `before` reads: every kind of value in the form the API keeps it.
     */
    async function expectEachInTheGroup(
      t: TestNextly,
      before: Map<string, Item>
    ): Promise<void> {
      const columns = await columnsOf(t);
      for (const name of MOVED) expect(columns).not.toContain(name);
      for (const entry of ENTRIES) {
        await t.nextly.create({
          collection: SLUG,
          data: {
            title: `${entry.title} direct`,
            slug: `${entry.slug}-direct`,
            meta: movedValues(before.get(entry.slug)),
          },
        });
      }
      const inside = await readAll(t);
      for (const entry of ENTRIES) {
        const moved = movedValues(inside.get(entry.slug)?.meta);
        expect(moved, `${entry.slug} in the group`).toEqual(
          movedValues(inside.get(`${entry.slug}-direct`)?.meta)
        );
        expect(moved).toEqual(asJson(movedValues(before.get(entry.slug))));
      }
    }

    /** Each entry's values back on the row as read `before`, and gone from the group: moved, not copied. */
    async function expectEachOutOfTheGroup(
      t: TestNextly,
      before: Map<string, Item>
    ): Promise<void> {
      const columns = await columnsOf(t);
      for (const name of MOVED) expect(columns).toContain(name);
      const outside = await readAll(t);
      for (const entry of ENTRIES) {
        const read = outside.get(entry.slug);
        expect(movedValues(read), entry.slug).toEqual(
          movedValues(before.get(entry.slug))
        );
        const left = Object.keys((read?.meta ?? {}) as Record<string, unknown>);
        expect(left.filter(key => MOVED.some(name => name === key))).toEqual(
          []
        );
      }
    }

    it("through the Builder's schema dialog: in, then back out", async () => {
      const t = await boot(dialect);
      await createPosts(t);
      await seed(t);
      const before = await readAll(t);

      await save(t, INSIDE, INTO);
      // An entry with no value holds each moved field as JSON null, as its column read: not a
      // missing key, which reads differently and which a default fills.
      const stored = (await storedGroups(t)).two as Record<string, unknown>;
      for (const name of MOVED) expect(stored).toHaveProperty(name);
      expect(stored.summary).toBeNull();
      expect(stored.published).toBeNull();
      await expectEachInTheGroup(t, before);

      await save(t, OUTSIDE, OUT);
      await expectEachOutOfTheGroup(t, before);
    });

    it("never sends a move to the push: one in a save another field's column change sends there is refused, else carried by the file", async () => {
      const t = await boot(dialect);
      const summary: Field = { name: "summary", type: "text" };
      const headline = (maxLength: number): Field => ({
        name: "headline",
        type: "text",
        options: { variant: "short" },
        validation: { maxLength },
      });
      await createPosts(t, SLUG, {
        fields: [summary, headline(40), group("meta", [NOTE])],
      });
      for (const [title, text] of [
        ["One", "First"],
        ["Two", "Second"],
      ] as const) {
        await t.nextly.create({
          collection: SLUG,
          data: { title, slug: title.toLowerCase(), summary: text },
        });
      }
      // The short text widened in the same save: varchar(40) to varchar(80) on PostgreSQL and
      // MySQL, a change only the push applies there; SQLite keeps both as text.
      const fields = [headline(80), group("meta", [NOTE, summary])];
      const moves = [{ from: ["summary"], to: ["meta", "summary"] }];
      if (dialect === "sqlite") {
        await save(t, fields, moves);
        const moved = await readAll(t);
        expect(
          ["one", "two"].map(
            slug => (moved.get(slug)?.meta as { summary?: unknown })?.summary
          )
        ).toEqual(["First", "Second"]);
        return;
      }
      const before = await readAll(t);
      const columns = (await columnsOf(t)).sort();
      await expect(save(t, fields, moves)).rejects.toThrow(
        expect.objectContaining({
          publicData: {
            errors: [
              expect.objectContaining({
                code: "FIELD_MOVE_REFUSED",
                message: expect.stringContaining("Save the move on its own."),
              }),
            ],
          },
        })
      );
      expect(await readAll(t)).toEqual(before);
      expect((await columnsOf(t)).sort()).toEqual(columns);
    });

    it("asks no rename of a moved column onto a field the same save adds", async () => {
      const t = await boot(dialect);
      const summary: Field = { name: "summary", type: "text" };
      const extra: Field = { name: "extra", type: "text" };
      await createPosts(t, SLUG, { fields: [summary, group("meta", [NOTE])] });
      await t.nextly.create({
        collection: SLUG,
        data: { title: "One", slug: "one", summary: "First" },
      });
      // `summary` leaves the row as `extra` arrives: a pair the push would offer as a rename, which
      // a move is not, since the file carries `summary`'s values into the group.
      await save(
        t,
        [extra, group("meta", [NOTE, summary])],
        [{ from: ["summary"], to: ["meta", "summary"] }]
      );
      const read = (await readAll(t)).get("one");
      expect((read?.meta as { summary?: unknown })?.summary).toBe("First");
      expect(read?.extra ?? null).toBeNull();
    });

    it("asks the drop of a removed field a hint names but no move carries, with only the moved column exempt", async () => {
      const t = await boot(dialect);
      const summary: Field = { name: "summary", type: "text" };
      const extra: Field = { name: "extra", type: "text" };
      await createPosts(t, SLUG, {
        fields: [summary, extra, group("meta", [NOTE])],
      });
      await t.nextly.create({
        collection: SLUG,
        data: { title: "One", slug: "one", summary: "First", extra: "Kept" },
      });
      const before = await readAll(t);
      // `summary` moves; `extra` is removed, and the hint naming it moves nothing (its path is the
      // same), so its drop is still the dialog's question, which this save leaves unanswered.
      await expect(
        save(
          t,
          [group("meta", [NOTE, summary])],
          [
            { from: ["summary"], to: ["meta", "summary"] },
            { from: ["extra"], to: ["extra"] },
          ]
        )
      ).rejects.toThrow(/cancelled/);
      expect(await readAll(t)).toEqual(before);
    });

    it("refuses a move while a working draft holds a pending value at the field's old place", async () => {
      const t = await boot(dialect);
      const summary: Field = { name: "summary", type: "text" };
      await createPosts(t, SLUG, { fields: [summary, group("meta", [NOTE])] });
      const { item } = await t.nextly.create({
        collection: SLUG,
        data: { title: "One", slug: "one", summary: "Live" },
      });
      const entryId = String((item as { id: unknown }).id);
      // A pending edit of `summary` held as the entry's working draft, which the move would not
      // carry: publishing it after the move would drop the edit.
      const now = new Date();
      await t.adapter.insert("nextly_versions", {
        id: randomUUID(),
        scopeKind: "collection",
        scopeSlug: SLUG,
        entryId,
        versionNo: null,
        status: "draft",
        isAutosave: false,
        snapshot: { title: "One", slug: "one", summary: "Pending edit" },
        createdAt: now,
        updatedAt: now,
      });
      const before = await readAll(t);
      const columns = (await columnsOf(t)).sort();
      const moves = [{ from: ["summary"], to: ["meta", "summary"] }];
      const refusal = expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "FIELD_MOVE_REFUSED",
              message:
                "summary has unpublished changes in a working draft of 1 entry, which keeps it where it was. Publish or discard those drafts first, then move summary.",
            }),
          ],
        },
      });
      await expect(
        save(t, [group("meta", [NOTE, summary])], moves)
      ).rejects.toThrow(refusal);
      expect(await readAll(t)).toEqual(before);
      expect((await columnsOf(t)).sort()).toEqual(columns);

      // Once the draft is gone, the move goes ahead.
      await run(
        t,
        `DELETE FROM ${q("nextly_versions")} WHERE ${q("entry_id")} = '${entryId}'`
      );
      await save(t, [group("meta", [NOTE, summary])], moves);
      expect(
        ((await readAll(t)).get("one")?.meta as { summary?: unknown })?.summary
      ).toBe("Live");
    });

    // A draft holding the field with a null may be clearing it, which the move would drop as it
    // drops an edit: refused the same way, as the file's own stop is.
    it("refuses a move while a working draft holds the field cleared at its old place", async () => {
      const t = await boot(dialect);
      const summary: Field = { name: "summary", type: "text" };
      await createPosts(t, SLUG, { fields: [summary, group("meta", [NOTE])] });
      const { item } = await t.nextly.create({
        collection: SLUG,
        data: { title: "One", slug: "one", summary: "Live" },
      });
      const now = new Date();
      await t.adapter.insert("nextly_versions", {
        id: randomUUID(),
        scopeKind: "collection",
        scopeSlug: SLUG,
        entryId: String((item as { id: unknown }).id),
        versionNo: null,
        status: "draft",
        isAutosave: false,
        snapshot: { title: "One", slug: "one", summary: null },
        createdAt: now,
        updatedAt: now,
      });
      const before = await readAll(t);
      await expect(
        save(
          t,
          [group("meta", [NOTE, summary])],
          [{ from: ["summary"], to: ["meta", "summary"] }]
        )
      ).rejects.toThrow(
        expect.objectContaining({
          publicData: {
            errors: [
              expect.objectContaining({
                code: "FIELD_MOVE_REFUSED",
                message: expect.stringMatching(
                  /^summary has unpublished changes in a working draft of 1 entry/
                ),
              }),
            ],
          },
        })
      );
      expect(await readAll(t)).toEqual(before);
    });

    // A draft that clears the group clears the field inside it, which a move out of the group
    // would drop: refused, as the file's own stop is.
    it("refuses a move out of a group while a working draft clears that group", async () => {
      const t = await boot(dialect);
      const summary: Field = { name: "summary", type: "text" };
      await createPosts(t, SLUG, { fields: [group("meta", [NOTE, summary])] });
      const { item } = await t.nextly.create({
        collection: SLUG,
        data: { title: "One", slug: "one", meta: { summary: "Live" } },
      });
      const now = new Date();
      await t.adapter.insert("nextly_versions", {
        id: randomUUID(),
        scopeKind: "collection",
        scopeSlug: SLUG,
        entryId: String((item as { id: unknown }).id),
        versionNo: null,
        status: "draft",
        isAutosave: false,
        snapshot: { title: "One", slug: "one", meta: null },
        createdAt: now,
        updatedAt: now,
      });
      const before = await readAll(t);
      await expect(
        save(
          t,
          [summary, group("meta", [NOTE])],
          [{ from: ["meta", "summary"], to: ["summary"] }]
        )
      ).rejects.toThrow(
        expect.objectContaining({
          publicData: {
            errors: [
              expect.objectContaining({
                code: "FIELD_MOVE_REFUSED",
                message: expect.stringMatching(
                  /^summary has unpublished changes in a working draft of 1 entry/
                ),
              }),
            ],
          },
        })
      );
      expect(await readAll(t)).toEqual(before);
    });

    // MySQL's TIMESTAMP holds no year past 2038.
    it.runIf(dialect !== "mysql")(
      "stops a move into a group, before it changes anything, where a date's year has more than four digits",
      async () => {
        const t = await boot(dialect);
        const published: Field = { name: "published", type: "date" };
        await createPosts(t, SLUG, {
          fields: [published, group("meta", [NOTE])],
        });
        await t.nextly.create({
          collection: SLUG,
          data: { title: "One", slug: "one" },
        });
        // The year 10000, which the copy would write in four digits as `10000-…` (PostgreSQL) or
        // as null (SQLite).
        await run(
          t,
          dialect === "postgresql"
            ? `UPDATE ${q(TABLE)} SET ${q("published")} = '10000-01-01 00:00:00' WHERE ${q("slug")} = 'one'`
            : `UPDATE ${q(TABLE)} SET ${q("published")} = 253402300800 WHERE ${q("slug")} = 'one'`
        );
        const columns = (await columnsOf(t)).sort();
        await expect(
          save(
            t,
            [group("meta", [NOTE, published])],
            [{ from: ["published"], to: ["meta", "published"] }]
          )
        ).rejects.toThrow(/cannot_keep_published/);
        expect((await columnsOf(t)).sort()).toEqual(columns);
      }
    );

    it("undoes a required field's move with nextly migrate:down, its column required again with every value", async () => {
      const t = await boot(dialect);
      const summary: Field = { name: "summary", type: "text", required: true };
      await createPosts(t, SLUG, { fields: [summary, group("meta", [NOTE])] });
      for (const [title, text] of [
        ["One", "First"],
        ["Two", "Second"],
      ] as const) {
        await t.nextly.create({
          collection: SLUG,
          data: { title, slug: title.toLowerCase(), summary: text },
        });
      }
      const required = async () =>
        (
          await readTableDefinition(
            statement => run(t, statement),
            dialect,
            TABLE
          )
        ).columns.find(column => column.name === "summary")?.nullable;
      expect(await required()).toBe(false);
      await save(
        t,
        [group("meta", [NOTE, summary])],
        [{ from: ["summary"], to: ["meta", "summary"] }]
      );

      // The column comes back nullable, takes its values from the group, then is required again.
      await migrateDown(t);

      const rows = await run<{ summary: string }>(
        t,
        `SELECT ${q("summary")} AS summary FROM ${q(TABLE)} ORDER BY ${q("slug")}`
      );
      expect(rows.map(row => row.summary)).toEqual(["First", "Second"]);
      expect(await required()).toBe(false);
    });

    it("stops undoing a required field's move where an entry made since holds no value for it, before anything changes", async () => {
      const t = await boot(dialect);
      const summary: Field = { name: "summary", type: "text", required: true };
      await createPosts(t, SLUG, { fields: [summary, group("meta", [NOTE])] });
      await t.nextly.create({
        collection: SLUG,
        data: { title: "One", slug: "one", summary: "First" },
      });
      await save(
        t,
        [group("meta", [NOTE, summary])],
        [{ from: ["summary"], to: ["meta", "summary"] }]
      );
      // An entry whose group was left out after the move: nothing for the restored column.
      await run(
        t,
        `UPDATE ${q(TABLE)} SET ${q("meta")} = NULL WHERE ${q("slug")} = 'one'`
      );
      const groups = await storedGroups(t);
      const columns = await columnsOf(t);

      await expect(migrateDown(t)).rejects.toThrow(/needs_a_value_summary/);

      expect(await storedGroups(t)).toEqual(groups);
      expect(await columnsOf(t)).toEqual(columns);
    });

    it("undoes a move into a nested group with nextly migrate:down, each group as it was before", async () => {
      const t = await boot(dialect);
      const summary: Field = { name: "summary", type: "text" };
      const hint: Field = { name: "hint", type: "text" };
      await createPosts(t, SLUG, {
        fields: [summary, group("meta", [NOTE, group("seo", [hint])])],
      });
      for (const slug of ["bare", "plain", "nested"]) {
        await t.nextly.create({
          collection: SLUG,
          data: { title: slug, slug, summary: `${slug} summary` },
        });
      }
      // No group at all, a group without the nested one, and one holding it: each kept as written.
      for (const [slug, meta] of [
        ["bare", "NULL"],
        ["plain", `'{"note":"n"}'`],
        ["nested", `'{"note":"n","seo":{"hint":"h"}}'`],
      ] as const) {
        await run(
          t,
          `UPDATE ${q(TABLE)} SET ${q("meta")} = ${meta} WHERE ${q("slug")} = '${slug}'`
        );
      }
      const before = await storedGroups(t);
      await save(
        t,
        [group("meta", [NOTE, group("seo", [hint, summary])])],
        [{ from: ["summary"], to: ["meta", "seo", "summary"] }]
      );
      // The way in makes the containers it needs, for every entry.
      expect((await storedGroups(t)).bare).toEqual({
        seo: { summary: "bare summary" },
      });

      await migrateDown(t);

      expect(await storedGroups(t)).toEqual(before);
      const rows = await run<{ summary: string }>(
        t,
        `SELECT ${q("summary")} AS summary FROM ${q(TABLE)} ORDER BY ${q("slug")}`
      );
      expect(rows.map(row => row.summary)).toEqual([
        "bare summary",
        "nested summary",
        "plain summary",
      ]);
    });

    it("moves the media library's record of a use with the field, both ways", async () => {
      const t = await boot(dialect);
      await createPosts(t, SLUG, { fields: INSIDE });
      const { item } = await t.nextly.create({
        collection: SLUG,
        data: { title: "One", slug: "one", meta: { summary: "First" } },
      });
      const entryId = String((item as { id: unknown }).id);
      const now = new Date();
      const mediaId = randomUUID();
      await t.adapter.insert("media", {
        id: mediaId,
        filename: `${mediaId}.png`,
        originalFilename: "used.png",
        mimeType: "image/png",
        size: 1,
        url: `/uploads/${mediaId}.png`,
        uploadedAt: now,
        updatedAt: now,
      });
      const use = (fieldPath: string, subjectSlug = SLUG) =>
        t.adapter.insert("nextly_media_usage", {
          id: randomUUID(),
          mediaId,
          subjectKind: "collection",
          subjectSlug,
          documentId: entryId,
          fieldPath,
          locale: "",
        });
      // The moved field's use; a sibling's; one whose name only starts with the field's; another
      // collection's at the same path.
      for (const path of ["meta.summary", "meta.note", "meta.summaryx"]) {
        await use(path);
      }
      await use("meta.summary", "gmv_other");
      const paths = async () =>
        (
          await run<{ slug: string; path: string }>(
            t,
            `SELECT ${q("subject_slug")} AS slug, ${q("field_path")} AS path FROM ${q("nextly_media_usage")}`
          )
        )
          .map(row => `${row.slug}:${row.path}`)
          .sort();

      await save(t, OUTSIDE, OUT);
      expect(await paths()).toEqual(
        [
          `${SLUG}:meta.note`,
          `${SLUG}:meta.summaryx`,
          `${SLUG}:summary`,
          "gmv_other:meta.summary",
        ].sort()
      );

      await migrateDown(t);
      expect(await paths()).toEqual(
        [
          `${SLUG}:meta.note`,
          `${SLUG}:meta.summary`,
          `${SLUG}:meta.summaryx`,
          "gmv_other:meta.summary",
        ].sort()
      );
    });

    it("keeps a use already recorded at the field's new path, rather than break the record's key", async () => {
      const t = await boot(dialect);
      await createPosts(t, SLUG, { fields: INSIDE });
      const { item } = await t.nextly.create({
        collection: SLUG,
        data: { title: "One", slug: "one", meta: { summary: "First" } },
      });
      const entryId = String((item as { id: unknown }).id);
      const now = new Date();
      const mediaId = randomUUID();
      await t.adapter.insert("media", {
        id: mediaId,
        filename: `${mediaId}.png`,
        originalFilename: "used.png",
        mimeType: "image/png",
        size: 1,
        url: `/uploads/${mediaId}.png`,
        uploadedAt: now,
        updatedAt: now,
      });
      // A row left at the new path by a field once there, for the same entry, item and language.
      for (const fieldPath of ["meta.summary", "summary"]) {
        await t.adapter.insert("nextly_media_usage", {
          id: randomUUID(),
          mediaId,
          subjectKind: "collection",
          subjectSlug: SLUG,
          documentId: entryId,
          fieldPath,
          locale: "",
        });
      }
      await save(t, OUTSIDE, OUT);
      const rows = await run<{ path: string }>(
        t,
        `SELECT ${q("field_path")} AS path FROM ${q("nextly_media_usage")}`
      );
      expect(rows.map(row => row.path).sort()).toEqual([
        "meta.summary",
        "summary",
      ]);
    });

    describe("a required field moved out of a group, onto a table holding entries", () => {
      const summary: Field = { name: "summary", type: "text", required: true };
      const inGroup = [group("meta", [NOTE, summary])];
      const onRow = [summary, group("meta", [NOTE])];
      const out = [{ from: ["meta", "summary"], to: ["summary"] }];

      async function seedSummaries(t: TestNextly): Promise<void> {
        await createPosts(t, SLUG, { fields: inGroup });
        for (const [title, text] of [
          ["One", "First"],
          ["Two", "Second"],
        ] as const) {
          await t.nextly.create({
            collection: SLUG,
            data: { title, slug: title.toLowerCase(), meta: { summary: text } },
          });
        }
      }
      const summaryColumn = async (t: TestNextly) =>
        (
          await readTableDefinition(
            statement => run(t, statement),
            dialect,
            TABLE
          )
        ).columns.find(column => column.name === "summary");

      it("keeps every value, the column required once they are in", async () => {
        const t = await boot(dialect);
        await seedSummaries(t);

        await save(t, onRow, out);

        expect((await summaryColumn(t))?.nullable).toBe(false);
        const rows = await run<{ summary: string }>(
          t,
          `SELECT ${q("summary")} AS summary FROM ${q(TABLE)} ORDER BY ${q("slug")}`
        );
        expect(rows.map(row => row.summary)).toEqual(["First", "Second"]);
      });

      it("is refused, nothing changed, when an entry holds no value to move", async () => {
        const t = await boot(dialect);
        await seedSummaries(t);
        await run(
          t,
          `UPDATE ${q(TABLE)} SET ${q("meta")} = '{}' WHERE ${q("slug")} = 'two'`
        );
        const stated = await definition();
        const files = await migrationFiles();

        // Counted before anything is written, on every dialect: on MySQL a refusal at the
        // statement making the column required would leave the added column behind.
        await expect(save(t, onRow, out)).rejects.toThrow(
          expect.objectContaining({
            publicData: {
              errors: [
                expect.objectContaining({
                  code: "FIELD_MOVE_REFUSED",
                  message: expect.stringMatching(
                    /^1 entry holds no value for summary in the group it moves out of, and it is required\./
                  ),
                }),
              ],
            },
          })
        );

        expect(await migrationFiles()).toEqual(files);
        expect(await summaryColumn(t)).toBeUndefined();
        expect(await definition()).toBe(stated);
        const one = (await readAll(t)).get("one");
        expect((one?.meta as Record<string, unknown>).summary).toBe("First");
      });

      it("refuses deleting the entries without a value, which would run before the values arrive", async () => {
        const t = await boot(dialect);
        await seedSummaries(t);
        const stated = await definition();

        await expect(
          dispatchCollections(
            {} as ServiceContainer,
            "applySchemaChanges",
            { collectionName: SLUG },
            {
              fields: onRow,
              confirmed: true,
              schemaVersion: await versionOf(t, SLUG),
              hints: { moves: out },
              eventResolutions: [
                {
                  kind: "delete_nonconforming",
                  eventId: `add_required_field_no_default:${TABLE}.summary`,
                },
              ],
            }
          )
        ).rejects.toThrow(
          expect.objectContaining({
            publicData: {
              errors: [expect.objectContaining({ code: "FIELD_MOVE_REFUSED" })],
            },
          })
        );

        expect(await definition()).toBe(stated);
        expect([...(await readAll(t)).keys()].sort()).toEqual(["one", "two"]);
      });
    });

    it("from one group to another, whose columns both stand, in a file of its own", async () => {
      const t = await boot(dialect);
      const summary: Field = { name: "summary", type: "text" };
      const tag: Field = { name: "tag", type: "text" };
      await createPosts(t, SLUG, {
        fields: [group("meta", [NOTE, summary]), group("extra", [tag])],
      });
      await t.nextly.create({
        collection: SLUG,
        data: { title: "One", slug: "one", meta: { summary: "First" } },
      });
      const files = await filesWritten();

      await save(
        t,
        [group("meta", [NOTE]), group("extra", [tag, summary])],
        [{ from: ["meta", "summary"], to: ["extra", "summary"] }]
      );

      // No column changes, and the save still writes and runs the file that moves the values,
      // naming the collection it changes and carrying its registry row, so a deploy's database
      // reads the field where the file put its values.
      expect(await filesWritten()).toBe(files + 1);
      const written = await newestFile();
      expect(written).toMatch(/^-- Collections: gmv_posts$/m);
      expect(written).toContain("dynamic_collections");
      const one = (await readAll(t)).get("one");
      expect((one?.extra as Record<string, unknown>).summary).toBe("First");
      expect(
        Object.keys((one?.meta ?? {}) as Record<string, unknown>)
      ).not.toContain("summary");
    });

    it("clears a key the group kept from a field it once had, where the moved field holds nothing", async () => {
      const t = await boot(dialect);
      await createPosts(t);
      await t.nextly.create({
        collection: SLUG,
        data: { title: "Empty", slug: "empty" },
      });
      // A group keeps the keys of a field taken out of it: its JSON is not rewritten.
      await run(
        t,
        `UPDATE ${q(TABLE)} SET ${q("meta")} = '{"summary":"old"}' WHERE ${q("slug")} = 'empty'`
      );

      await save(t, INSIDE, INTO);

      expect(movedValues((await readAll(t)).get("empty")?.meta)).toEqual({
        summary: null,
        views: null,
        featured: null,
        published: null,
      });
    });

    it("through nextly migrate, replaying the dialog's files into a second database", async () => {
      const first = await boot(dialect);
      await createPosts(first);
      const created = await filesWritten();
      await seed(first);
      const before = await readAll(first);
      await save(first, INSIDE, INTO);
      const movedIn = await filesWritten();
      const groupsInside = await storedGroups(first);
      await save(first, OUTSIDE, OUT);
      expect(movedIn).toBeGreaterThan(created);
      expect(await filesWritten()).toBeGreaterThan(movedIn);
      await first.destroy();
      instance = undefined;

      const second = await boot(dialect);
      await migrateFolder(second, created);
      // The definition the run records is the newest, which holds the fields where they began.
      await seed(second);
      // An unattended run asks consent for every column a file drops, a moved field's included,
      // as it does for the columns turning translation on moves: given for those four alone.
      await migrateFolder(
        second,
        movedIn - created,
        resolveDataLossConsent({
          flag: MOVED.map(name => `${TABLE}.${name}`).join(","),
          env: {},
        })
      );

      for (const name of MOVED)
        expect(await columnsOf(second)).not.toContain(name);
      expect(await storedGroups(second)).toEqual(groupsInside);

      await migrateFolder(second);

      const replayed = await readAll(second);
      for (const entry of ENTRIES) {
        expect(movedValues(replayed.get(entry.slug)), entry.slug).toEqual(
          movedValues(before.get(entry.slug))
        );
      }
    });

    /**
     * What a database may give a column besides what Nextly writes: a comment, and on MySQL a
     * collation of its own. SQLite keeps neither.
     */
    async function giveSummaryExtras(t: TestNextly): Promise<void> {
      if (dialect === "postgresql") {
        await run(
          t,
          `COMMENT ON COLUMN ${q(TABLE)}.${q("summary")} IS 'Shown in lists'`
        );
      } else if (dialect === "mysql") {
        const [column] = await run<{ type: string }>(
          t,
          `SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${TABLE}' AND COLUMN_NAME = 'summary'`
        );
        await run(
          t,
          `ALTER TABLE ${q(TABLE)} MODIFY COLUMN ${q("summary")} ${column?.type ?? ""} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'Shown in lists'`
        );
      }
    }

    /** The review's sentence for the moved summary column, naming each property it had. */
    function expectNamesEachProperty(sentence: string | undefined): void {
      expect(sentence).toContain("constraint NOT NULL");
      expect(sentence).toMatch(/: type \S+/);
      // MySQL cannot index a whole TEXT column, so Nextly gives this one no index there, and
      // none is named; the other dialects index it.
      if (dialect === "mysql") {
        expect(sentence).not.toContain("index ");
      } else {
        expect(sentence).toMatch(/index \S*summary\S*/);
      }
      if (dialect !== "sqlite") {
        expect(sentence).toContain("comment Shown in lists");
      }
      if (dialect === "mysql") {
        expect(sentence).toContain("collation utf8mb4_bin");
        // The table's own character set is every column's; only one of the column's own is named.
        expect(sentence).not.toContain("character set");
      }
    }

    /** The `-- Deletes:` lines of the newest migration file the saves wrote. */
    async function newestDeletesLines(): Promise<string> {
      return (await newestFile())
        .split("\n")
        .filter(line => line.startsWith("-- Deletes:"))
        .join("\n");
    }

    it("names what the moved column had that the group does not carry, in the review and the file", async () => {
      const t = await boot(dialect);
      const summary: Field = {
        name: "summary",
        type: "text",
        required: true,
        index: true,
      };
      await createPosts(t, SLUG, { fields: [summary, group("meta", [NOTE])] });
      await giveSummaryExtras(t);
      for (const [title, text] of [
        ["One", "First"],
        ["Two", "Second"],
      ] as const) {
        await t.nextly.create({
          collection: SLUG,
          data: { title, slug: title.toLowerCase(), summary: text },
        });
      }
      const definitionOf = async () =>
        (
          await readTableDefinition(
            statement => run(t, statement),
            dialect,
            TABLE
          )
        ).columns.filter(column => column.name !== "summary");
      const others = await definitionOf();
      const into = [{ from: ["summary"], to: ["meta", "summary"] }];
      const fields = [group("meta", [NOTE, summary])];

      const reviewed = (await (
        (await preview(fields, into)) as Response
      ).json()) as { notices: string[] };
      const sentence = reviewed.notices.find(notice =>
        notice.startsWith("Moving summary into meta keeps every value")
      );
      expect(sentence, reviewed.notices.join("\n")).toBeDefined();
      expectNamesEachProperty(sentence);

      await save(t, fields, into);

      expect(await newestDeletesLines()).toContain(sentence);
      // Applied to no other column: every other column stands as it was.
      expect(await definitionOf()).toEqual(others);
      const read = await readAll(t);
      expect((read.get("one")?.meta as Record<string, unknown>).summary).toBe(
        "First"
      );
      expect((read.get("two")?.meta as Record<string, unknown>).summary).toBe(
        "Second"
      );
    });

    it("moves a date alone out of a group as that day, whatever zone the database's sessions read in", async () => {
      const t = await boot(dialect);
      await createPosts(t, SLUG, { fields: INSIDE });
      await t.nextly.create({
        collection: SLUG,
        data: { title: "Day", slug: "day", meta: { published: "2026-07-17" } },
      });
      if (dialect === "postgresql") {
        // A zone ahead of UTC for every session of this instance's own database, which the
        // adapter's sessions take once it reconnects: `::timestamptz` reads a date alone there.
        await run(
          t,
          `DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Karachi'); END $$`
        );
        await t.adapter.disconnect();
        await t.adapter.connect();
        const [zone] = await run<{ TimeZone: string }>(t, "SHOW timezone");
        expect(zone?.TimeZone).toBe("Asia/Karachi");
      }
      await save(t, OUTSIDE, OUT);
      const moved = (await readAll(t)).get("day");
      expect(new Date(moved?.published as string).toISOString()).toBe(
        "2026-07-17T00:00:00.000Z"
      );
    });

    // Far from 1970 either way, or on MySQL, whose TIMESTAMP column holds 1970 to 2038, at each end
    // of that range, where the local time written is outside it.
    const farDates =
      dialect === "mysql"
        ? {
            early: ["1970-01-01T05:00:01+05:00", "1970-01-01T00:00:01.000Z"],
            late: ["2038-01-19T08:14:07+05:00", "2038-01-19T03:14:07.000Z"],
          }
        : {
            early: ["1960-01-01T10:00:00+05:00", "1960-01-01T05:00:00.000Z"],
            late: ["3500-01-01T10:00:00+05:00", "3500-01-01T05:00:00.000Z"],
          };

    it("moves a date written at an offset out of a group as its instant, at the far ends its column holds", async () => {
      const t = await boot(dialect);
      await createPosts(t, SLUG, { fields: INSIDE });
      const written = {
        early: farDates.early[0],
        late: farDates.late[0],
      };
      for (const [slug, published] of Object.entries(written)) {
        await t.nextly.create({
          collection: SLUG,
          data: { title: slug, slug },
        });
        // Written as an entry may hold it, with its offset, which the API would rewrite at UTC.
        await run(
          t,
          `UPDATE ${q(TABLE)} SET ${q("meta")} = '${JSON.stringify({ published })}' WHERE ${q("slug")} = '${slug}'`
        );
      }
      await save(t, OUTSIDE, OUT);
      const moved = await readAll(t);
      expect(
        new Date(moved.get("early")?.published as string).toISOString()
      ).toBe(farDates.early[1]);
      expect(
        new Date(moved.get("late")?.published as string).toISOString()
      ).toBe(farDates.late[1]);
    });

    it("keeps every value where a move's group only changes its spelling, in one column", async () => {
      const t = await boot(dialect);
      const summary: Field = { name: "summary", type: "text" };
      await createPosts(t, SLUG, {
        fields: [group("seoMeta", [NOTE, summary])],
      });
      await t.nextly.create({
        collection: SLUG,
        data: {
          title: "One",
          slug: "one",
          seoMeta: { note: "n", summary: "kept" },
        },
      });
      // `seoMeta` and `seo_meta` are one column, so the field's key stays where it is.
      await save(
        t,
        [group("seo_meta", [NOTE, summary])],
        [{ from: ["seoMeta", "summary"], to: ["seo_meta", "summary"] }]
      );
      const [row] = await run<{ held: unknown }>(
        t,
        `SELECT ${q("seo_meta")} AS held FROM ${q(TABLE)} WHERE ${q("slug")} = 'one'`
      );
      const held =
        typeof row?.held === "string" ? JSON.parse(row.held) : row?.held;
      expect(held).toEqual({ note: "n", summary: "kept" });
    });

    it("clears a key the destination group kept, where the group the field leaves is not there at all", async () => {
      const t = await boot(dialect);
      const summary: Field = { name: "summary", type: "text" };
      const tag: Field = { name: "tag", type: "text" };
      await createPosts(t, SLUG, {
        fields: [group("meta", [NOTE, summary]), group("extra", [tag])],
      });
      await t.nextly.create({
        collection: SLUG,
        data: { title: "One", slug: "one" },
      });
      // No group value at all, where the other group still keeps a key of that name.
      await run(
        t,
        `UPDATE ${q(TABLE)} SET ${q("meta")} = NULL, ${q("extra")} = '{"summary":"old"}' WHERE ${q("slug")} = 'one'`
      );

      await save(
        t,
        [group("meta", [NOTE]), group("extra", [tag, summary])],
        [{ from: ["meta", "summary"], to: ["extra", "summary"] }]
      );

      const one = (await readAll(t)).get("one");
      expect(
        (one?.extra as Record<string, unknown>)?.summary ?? null
      ).toBeNull();
    });

    describe.runIf(dialect === "sqlite")(
      "on SQLite, where a date column keeps whole seconds",
      () => {
        it.each([
          ["a date SQLite does not read", "July 17, 2026"],
          ["a date with milliseconds", "2026-07-17T10:00:05.123Z"],
          ["a day that does not exist", "2026-02-30"],
          ["a time with no offset", "2026-07-17T10:00:00"],
        ])(
          "stops a replayed move of dates out of a group, nothing changed, where an entry holds %s",
          async (_what, unkept) => {
            const first = await boot(dialect);
            await createPosts(first);
            const created = await filesWritten();
            await seed(first);
            await save(first, INSIDE, INTO);
            const movedIn = await filesWritten();
            await save(first, OUTSIDE, OUT);
            await first.destroy();
            instance = undefined;

            // A deploy's database: the same files, entries the first database never held.
            const second = await boot(dialect);
            await migrateFolder(second, created);
            await seed(second);
            await migrateFolder(
              second,
              movedIn - created,
              resolveDataLossConsent({
                flag: MOVED.map(name => `${TABLE}.${name}`).join(","),
                env: {},
              })
            );
            await run(
              second,
              `UPDATE ${q(TABLE)} SET ${q("meta")} = json_set(${q("meta")}, '$.published', '${unkept}') WHERE ${q("slug")} = 'one'`
            );
            const groups = await storedGroups(second);
            const columns = await columnsOf(second);

            await expect(migrateFolder(second)).rejects.toThrow(
              /nextly_unreadable_date_published\.an_entry_holds_a_date_sqlite_cannot_keep/
            );

            expect(await storedGroups(second)).toEqual(groups);
            expect(await columnsOf(second)).toEqual(columns);
          }
        );
      }
    );

    describe("replayed on a deploy's database, holding values the save never saw", () => {
      const views: Field = { name: "views", type: "number" };
      const featured: Field = { name: "featured", type: "checkbox" };
      const price: Field = {
        name: "price",
        type: "number",
        dbType: "decimal",
        precision: 10,
        scale: 2,
      };
      const headline: Field = {
        name: "headline",
        type: "text",
        options: { variant: "short" },
        validation: { maxLength: 40 },
      };
      const published: Field = { name: "published", type: "date" };
      const kept = [views, featured, price, headline, published];
      const inside = [group("meta", [NOTE, ...kept])];
      const outside = [...kept, group("meta", [NOTE])];
      const out = kept.map(field => ({
        from: ["meta", String(field.name)],
        to: [String(field.name)],
      }));

      /** The move-out file written on a first database, the files before it run on a second. */
      async function deployed(
        fields: { inside: Field[]; outside: Field[]; out: typeof out } = {
          inside,
          outside,
          out,
        }
      ): Promise<TestNextly> {
        const first = await boot(dialect);
        await createPosts(first, SLUG, { fields: fields.inside });
        const created = await filesWritten();
        await save(first, fields.outside, fields.out);
        await first.destroy();
        instance = undefined;
        const second = await boot(dialect);
        await migrateFolder(second, created);
        await second.nextly.create({
          collection: SLUG,
          data: { title: "One", slug: "one" },
        });
        return second;
      }

      async function holding(t: TestNextly, meta: Record<string, unknown>) {
        await run(
          t,
          `UPDATE ${q(TABLE)} SET ${q("meta")} = '${JSON.stringify(meta)}' WHERE ${q("slug")} = 'one'`
        );
      }

      // SQLite keeps a number or a text as it is: only a checkbox's value is read as another there.
      const unkept: [string, unknown][] = [
        ["featured", "yes"],
        ...(dialect === "sqlite"
          ? []
          : ([
              ["views", 2147483648],
              ["price", 1.239],
              ["headline", "x".repeat(100)],
              // A time with no offset, which PostgreSQL would read in its session's zone.
              ["published", "2026-07-17T10:00:00"],
              ["published", "2026-02-30"],
            ] as [string, unknown][])),
      ];

      it.each(unkept)(
        "stops the file before it changes anything, naming %s, where an entry holds %j",
        async (field, value) => {
          const t = await deployed();
          await holding(t, { [field]: value });
          const groups = await storedGroups(t);
          const columns = await columnsOf(t);

          await expect(migrateFolder(t)).rejects.toThrow(
            new RegExp(`cannot_keep_${field}`)
          );

          expect(await storedGroups(t)).toEqual(groups);
          expect(await columnsOf(t)).toEqual(columns);
        }
      );

      it("stops the file before it changes anything where an entry holds no value for a field made required as it moves", async () => {
        const optional: Field = { name: "summary", type: "text" };
        const t = await deployed({
          inside: [group("meta", [NOTE, optional])],
          outside: [{ ...optional, required: true }, group("meta", [NOTE])],
          out: [{ from: ["meta", "summary"], to: ["summary"] }],
        });
        // The entry the first database never had: no value for the field now required.
        await holding(t, { note: "n" });
        const groups = await storedGroups(t);
        const columns = await columnsOf(t);

        await expect(migrateFolder(t)).rejects.toThrow(/needs_a_value_summary/);

        expect(await storedGroups(t)).toEqual(groups);
        expect(await columnsOf(t)).toEqual(columns);
      });

      it("names a field of 60 characters within every dialect's identifier bound", async () => {
        // MySQL refuses a name past 64 characters; PostgreSQL cuts one past 63.
        const name = `featured${"x".repeat(52)}`;
        expect(name).toHaveLength(60);
        const long: Field = { name, type: "checkbox" };
        const t = await deployed({
          inside: [group("meta", [NOTE, long])],
          outside: [long, group("meta", [NOTE])],
          out: [{ from: ["meta", name], to: [name] }],
        });
        await holding(t, { [name]: "yes" });
        const columns = await columnsOf(t);

        // The bounded name keeps as much of the field's as fits, then a hash of the whole.
        await expect(migrateFolder(t)).rejects.toThrow(
          /cannot_keep_featuredx+_[0-9a-z]+/
        );
        expect(await columnsOf(t)).toEqual(columns);
      });

      it("applies the file where every value fits its column", async () => {
        const t = await deployed();
        await holding(t, {
          views: 2147483647,
          featured: true,
          price: 1.23,
          headline: "y".repeat(40),
          published: "2026-07-17T10:00:00+05:00",
        });
        await migrateFolder(t);
        const [row] = await run<Record<string, unknown>>(
          t,
          `SELECT ${q("views")} AS views, ${q("price")} AS price, ${q("headline")} AS headline FROM ${q(TABLE)} WHERE ${q("slug")} = 'one'`
        );
        expect(Number(row?.views)).toBe(2147483647);
        expect(Number(row?.price)).toBe(1.23);
        expect(row?.headline).toBe("y".repeat(40));
      });
    });

    // MySQL runs each statement as it comes, so the file's stop runs before its schema changes:
    // nothing is added, and the group keeps every date.
    it.runIf(dialect === "mysql")(
      "stops a replayed move of a date its TIMESTAMP column does not hold before anything changes",
      async () => {
        const first = await boot(dialect);
        await createPosts(first);
        const created = await filesWritten();
        await seed(first);
        await save(first, INSIDE, INTO);
        const movedIn = await filesWritten();
        await save(first, OUTSIDE, OUT);
        await first.destroy();
        instance = undefined;

        const second = await boot(dialect);
        await migrateFolder(second, created);
        await seed(second);
        await migrateFolder(
          second,
          movedIn - created,
          resolveDataLossConsent({
            flag: MOVED.map(name => `${TABLE}.${name}`).join(","),
            env: {},
          })
        );
        await run(
          second,
          `UPDATE ${q(TABLE)} SET ${q("meta")} = JSON_SET(${q("meta")}, '$.published', '1960-01-01T00:00:00.000Z') WHERE ${q("slug")} = 'one'`
        );
        const groups = await storedGroups(second);
        expect(await columnsOf(second)).not.toContain("published");

        await expect(migrateFolder(second)).rejects.toThrow(
          /cannot_keep_published/
        );

        expect(await storedGroups(second)).toEqual(groups);
        expect(await columnsOf(second)).not.toContain("published");
      }
    );

    it("writes the collection's new definition only after the values moved out of a group are in", async () => {
      const t = await boot(dialect);
      await createPosts(t, SLUG, { fields: INSIDE });
      await save(t, OUTSIDE, OUT);
      // On MySQL each statement stands as it runs: a definition written before the copy would
      // read an empty column, where a run stops between them, while the values sit in the group.
      const { upSql } = parseSqlSections(await newestFile());
      const copy = upSql.indexOf(`UPDATE ${q(TABLE)} SET ${q("views")} =`);
      expect(copy).toBeGreaterThanOrEqual(0);
      expect(upSql.indexOf("dynamic_collections")).toBeGreaterThan(copy);
    });

    // Out of a group into a column its definition makes unique: the column is made unique, its
    // repeats counted before anything is written and stopped over in the file on any other
    // database.
    describe("a unique field moved out of a group", () => {
      const code: Field = { name: "code", type: "text" };
      const uniqueCode: Field = { ...code, unique: true };
      const GROUPED: Field[] = [group("meta", [NOTE, code])];
      const ON_ROW: Field[] = [uniqueCode, group("meta", [NOTE])];
      const OUT_OF_META = [{ from: ["meta", "code"], to: ["code"] }];

      /** Entries holding `codes` in their group, one each. */
      async function seedCodes(
        t: TestNextly,
        codes: readonly string[]
      ): Promise<void> {
        for (const [i, value] of codes.entries()) {
          await t.nextly.create({
            collection: SLUG,
            data: { title: `P${i}`, slug: `p${i}`, meta: { code: value } },
          });
        }
      }

      it("is moved, its column unique: every value kept, and a repeat refused", async () => {
        const t = await boot(dialect);
        await createPosts(t, SLUG, { fields: GROUPED });
        await seedCodes(t, ["a", "b"]);

        await save(t, ON_ROW, OUT_OF_META);

        const after = await readAll(t);
        expect([...after.values()].map(item => item.code).sort()).toEqual([
          "a",
          "b",
        ]);
        await expect(
          t.nextly.create({
            collection: SLUG,
            data: { title: "Again", slug: "again", code: "a" },
          })
        ).rejects.toThrow();
      });

      it("is refused, nothing changed, while two entries hold one value, naming the field and the count", async () => {
        const t = await boot(dialect);
        await createPosts(t, SLUG, { fields: GROUPED });
        await seedCodes(t, ["a", "a", "b", "b", "c"]);
        const before = await readAll(t);
        const files = await migrationFiles();
        const stated = await definition();
        const columns = (await columnsOf(t)).sort();
        const registry = await registryRow(t);

        await expect(save(t, ON_ROW, OUT_OF_META)).rejects.toThrow(
          expect.objectContaining({
            publicData: {
              errors: [
                expect.objectContaining({
                  code: "FIELD_MOVE_REFUSED",
                  message:
                    "code is unique where it moves to, and 2 of its values are held by more than one entry in the group it moves out of. Give each entry its own value, or clear the repeats, then move it.",
                }),
              ],
            },
          })
        );

        expect(await readAll(t)).toEqual(before);
        expect(await migrationFiles()).toEqual(files);
        expect(await definition()).toBe(stated);
        expect((await columnsOf(t)).sort()).toEqual(columns);
        expect(await registryRow(t)).toBe(registry);
      });

      // The save counted its own database; a deploy's may repeat a value that one never did. The file
      // stops before it changes anything there.
      it("stops a replay on a database whose entries repeat a value, before anything changes", async () => {
        const first = await boot(dialect);
        await createPosts(first, SLUG, { fields: GROUPED });
        const created = await filesWritten();
        await seedCodes(first, ["a", "b"]);
        await save(first, ON_ROW, OUT_OF_META);
        await first.destroy();
        instance = undefined;

        const second = await boot(dialect);
        await migrateFolder(second, created);
        await seedCodes(second, ["a", "a"]);
        const groups = await storedGroups(second);
        const columns = (await columnsOf(second)).sort();

        await expect(migrateFolder(second)).rejects.toThrow(
          /nextly_repeated_code\.two_entries_hold_one_code|two_entries_hold_one_code/
        );

        expect(await storedGroups(second)).toEqual(groups);
        expect((await columnsOf(second)).sort()).toEqual(columns);
      });

      /**
       * Entries whose group holds each of `held` at `field`, written into the group's JSON as
       * given (`held` is JSON text), beside a note: forms the API would not write itself, which
       * a database's own rows may still hold.
       */
      async function seedHeld(
        t: TestNextly,
        field: string,
        held: readonly string[]
      ): Promise<void> {
        for (const [i, json] of held.entries()) {
          await t.nextly.create({
            collection: SLUG,
            data: { title: `P${i}`, slug: `p${i}`, meta: { note: "n" } },
          });
          await run(
            t,
            `UPDATE ${q(TABLE)} SET ${q("meta")} = '{"note":"n","${field}":${json}}' WHERE ${q("slug")} = 'p${i}'`
          );
        }
      }

      // Values whose JSON differs but which the unique column stores as one value: compared as
      // they arrive there, so the copy never meets a repeat part-way through the file.
      const SAME_STORED = [
        {
          what: "one instant written at two offsets",
          field: { name: "day", type: "date" },
          held: ['"2026-07-17T10:00:00Z"', '"2026-07-17T12:00:00+02:00"'],
        },
        {
          what: "one decimal written with and without its trailing zeros",
          field: { name: "price", type: "number", dbType: "decimal" },
          held: ["1", "1.00"],
        },
        {
          what: "one whole number written as a number and as text",
          field: { name: "rank", type: "number" },
          held: ["1", '"1"'],
        },
        {
          what: "one fraction written as a number and as text",
          field: {
            name: "ratio",
            type: "number",
            options: { format: "float" },
          },
          held: ["1.5", '"1.50"'],
        },
        {
          what: "one text written as a number and as text",
          field: { name: "label", type: "text" },
          held: ["1", '"1"'],
        },
      ] as const;

      it.each(SAME_STORED)(
        "is refused while two entries hold $what, nothing changed",
        async ({ field, held }) => {
          const t = await boot(dialect);
          await createPosts(t, SLUG, {
            fields: [group("meta", [NOTE, field])],
          });
          await seedHeld(t, field.name, held);
          const groups = await storedGroups(t);
          const files = await migrationFiles();
          const columns = (await columnsOf(t)).sort();
          const registry = await registryRow(t);

          await expect(
            save(
              t,
              [{ ...field, unique: true }, group("meta", [NOTE])],
              [{ from: ["meta", field.name], to: [field.name] }]
            )
          ).rejects.toThrow(
            expect.objectContaining({
              publicData: {
                errors: [
                  expect.objectContaining({
                    code: "FIELD_MOVE_REFUSED",
                    message: `${field.name} is unique where it moves to, and 1 of its values is held by more than one entry in the group it moves out of. Give each entry its own value, or clear the repeats, then move it.`,
                  }),
                ],
              },
            })
          );

          expect(await storedGroups(t)).toEqual(groups);
          expect(await migrationFiles()).toEqual(files);
          expect((await columnsOf(t)).sort()).toEqual(columns);
          expect(await registryRow(t)).toBe(registry);
        }
      );

      it("stops a replay on a database whose entries hold one instant at two offsets", async () => {
        const day = { name: "day", type: "date" };
        const first = await boot(dialect);
        await createPosts(first, SLUG, {
          fields: [group("meta", [NOTE, day])],
        });
        const created = await filesWritten();
        await seedHeld(first, "day", ['"2026-07-17T10:00:00Z"']);
        await save(
          first,
          [{ ...day, unique: true }, group("meta", [NOTE])],
          [{ from: ["meta", "day"], to: ["day"] }]
        );
        await first.destroy();
        instance = undefined;

        const second = await boot(dialect);
        await migrateFolder(second, created);
        await seedHeld(second, "day", [
          '"2026-07-17T10:00:00Z"',
          '"2026-07-17T12:00:00+02:00"',
        ]);
        const groups = await storedGroups(second);
        const columns = (await columnsOf(second)).sort();

        await expect(migrateFolder(second)).rejects.toThrow(
          /two_entries_hold_one_day/
        );

        expect(await storedGroups(second)).toEqual(groups);
        expect((await columnsOf(second)).sort()).toEqual(columns);
      });

      // The new column takes its table's collation, not the server's: the count reads it where the
      // values are, so a table in another collation is counted as its own column compares.
      it.runIf(dialect === "mysql")(
        "counts codes its table's own collation holds as one, whatever the server's default, nothing changed",
        async () => {
          const t = await boot(dialect);
          await createPosts(t, SLUG, { fields: GROUPED });
          // Ignores trailing spaces (PAD SPACE), where the server's default does not.
          await run(
            t,
            `ALTER TABLE ${q(TABLE)} CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
          );
          await seedHeld(t, "code", ['"a"', '"a "']);
          const groups = await storedGroups(t);
          const files = await migrationFiles();
          const columns = (await columnsOf(t)).sort();
          const registry = await registryRow(t);

          await expect(save(t, ON_ROW, OUT_OF_META)).rejects.toThrow(
            expect.objectContaining({
              publicData: {
                errors: [
                  expect.objectContaining({
                    code: "FIELD_MOVE_REFUSED",
                    message: expect.stringContaining(
                      "1 of its values is held by more than one entry"
                    ),
                  }),
                ],
              },
            })
          );

          expect(await storedGroups(t)).toEqual(groups);
          expect(await migrationFiles()).toEqual(files);
          expect((await columnsOf(t)).sort()).toEqual(columns);
          expect(await registryRow(t)).toBe(registry);
        }
      );

      it.runIf(dialect === "mysql")(
        "moves codes a stricter collation of its table keeps apart, which the server's default would not",
        async () => {
          const t = await boot(dialect);
          await createPosts(t, SLUG, { fields: GROUPED });
          await run(
            t,
            `ALTER TABLE ${q(TABLE)} CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`
          );
          await seedCodes(t, ["Code", "code"]);

          await save(t, ON_ROW, OUT_OF_META);

          const after = await readAll(t);
          expect([...after.values()].map(item => item.code).sort()).toEqual([
            "Code",
            "code",
          ]);
        }
      );

      it.runIf(dialect === "mysql")(
        "stops a replay on a database whose table's collation holds one code as two, before anything changes",
        async () => {
          const first = await boot(dialect);
          await createPosts(first, SLUG, { fields: GROUPED });
          const created = await filesWritten();
          await seedCodes(first, ["a", "b"]);
          await save(first, ON_ROW, OUT_OF_META);
          await first.destroy();
          instance = undefined;

          const second = await boot(dialect);
          await migrateFolder(second, created);
          await run(
            second,
            `ALTER TABLE ${q(TABLE)} CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
          );
          await seedHeld(second, "code", ['"a"', '"a "']);
          const groups = await storedGroups(second);
          const columns = (await columnsOf(second)).sort();

          await expect(migrateFolder(second)).rejects.toThrow(
            /two_entries_hold_one_code/
          );

          expect(await storedGroups(second)).toEqual(groups);
          expect((await columnsOf(second)).sort()).toEqual(columns);
        }
      );

      // The limit of comparing by the table's `id` column: a table whose default collation was
      // changed without converting its columns keeps the older one there, while the column the move
      // adds takes the new default. What the comparison misses, the index refuses, part-way through
      // the copy, with every value still in the group.
      it.runIf(dialect === "mysql")(
        "compares by the older collation where a table's default was changed without converting its columns, and the index refuses the copy with every value intact",
        async () => {
          const t = await boot(dialect);
          await createPosts(t, SLUG, { fields: GROUPED });
          await run(t, `ALTER TABLE ${q(TABLE)} COLLATE = utf8mb4_unicode_ci`);
          await seedHeld(t, "code", ['"a"', '"a "']);
          const groups = await storedGroups(t);

          await expect(save(t, ON_ROW, OUT_OF_META)).rejects.toThrow(
            /stopped part way/
          );

          expect(await storedGroups(t)).toEqual(groups);
        }
      );

      // Every stop of a file comes before any move's writes, each way, so a run the file stops has
      // changed nothing whatever ran it: one outside a transaction keeps every statement before it.
      it("stops a replay before any move of the same save has written, whichever move is first", async () => {
        const tag: Field = { name: "tag", type: "text" };
        const summary: Field = { name: "summary", type: "text" };
        const before = [
          summary,
          group("meta", [NOTE, code]),
          group("seo", [NOTE, tag]),
        ];
        const after = [
          uniqueCode,
          group("meta", [NOTE, summary, tag]),
          group("seo", [NOTE]),
        ];
        const moves = [
          { from: ["summary"], to: ["meta", "summary"] },
          { from: ["seo", "tag"], to: ["meta", "tag"] },
          { from: ["meta", "code"], to: ["code"] },
        ];
        const first = await boot(dialect);
        await createPosts(first, SLUG, { fields: before });
        const created = await filesWritten();
        const seedAll = async (t: TestNextly, codes: readonly string[]) => {
          for (const [i, value] of codes.entries()) {
            await t.nextly.create({
              collection: SLUG,
              data: {
                title: `P${i}`,
                slug: `p${i}`,
                summary: `S${i}`,
                meta: { note: "n", code: value },
                seo: { note: "n", tag: `T${i}` },
              },
            });
          }
        };
        await seedAll(first, ["a", "b"]);
        await save(first, after, moves);
        const { upSql, downSql } = parseSqlSections(await newestFile());
        for (const [way, sql] of [
          ["up", upSql],
          ["down", downSql],
        ] as const) {
          const lastStop = Math.max(
            -1,
            ...[...sql.matchAll(/nextly_(repeated|unkept|unfilled)_/g)].map(
              stop => stop.index
            )
          );
          const firstWrite = sql.search(/^UPDATE /m);
          expect(firstWrite, way).toBeGreaterThanOrEqual(0);
          expect(lastStop, way).toBeLessThan(firstWrite);
        }
        expect(upSql).toContain("nextly_repeated_code");
        await first.destroy();
        instance = undefined;

        const second = await boot(dialect);
        await migrateFolder(second, created);
        await seedAll(second, ["a", "a"]);
        const rows = () =>
          run(second, `SELECT * FROM ${q(TABLE)} ORDER BY ${q("slug")}`);
        const stood = await rows();

        // The file drops the column `summary` leaves, which the run asks consent for.
        await expect(
          migrateFolder(
            second,
            undefined,
            resolveDataLossConsent({ flag: true, env: {} })
          )
        ).rejects.toThrow(/two_entries_hold_one_code/);

        expect(await rows()).toEqual(stood);
      });

      // MySQL's text column folds case, as its database's default collation does; PostgreSQL's
      // and SQLite's compare text as written, so there the two are two values and move.
      it("counts two codes differing only in case as one where the column does", async () => {
        const t = await boot(dialect);
        await createPosts(t, SLUG, { fields: GROUPED });
        await seedCodes(t, ["Code", "code"]);

        const saving = save(t, ON_ROW, OUT_OF_META);
        if (dialect === "mysql") {
          await expect(saving).rejects.toThrow(
            expect.objectContaining({
              publicData: {
                errors: [
                  expect.objectContaining({
                    code: "FIELD_MOVE_REFUSED",
                    message: expect.stringContaining(
                      "1 of its values is held by more than one entry"
                    ),
                  }),
                ],
              },
            })
          );
          return;
        }
        await saving;
        const after = await readAll(t);
        expect([...after.values()].map(item => item.code).sort()).toEqual([
          "Code",
          "code",
        ]);
      });
    });

    describe("a move that cannot keep its values is refused before anything is written", () => {
      /** The save refused, in its review and in its apply, and nothing about the database changed. */
      async function expectRefused(
        t: TestNextly,
        fields: Field[],
        moves: { from: string[]; to: string[] }[],
        message: string,
        slug = SLUG
      ): Promise<void> {
        const files = await migrationFiles();
        const stated = await definition();
        const table = slug === SLUG ? TABLE : `dc_${slug}`;
        const columns = await columnsOf(t, table);
        const registry = await registryRow(t, slug);
        const refusal = expect.objectContaining({
          publicData: {
            errors: [
              expect.objectContaining({
                code: "FIELD_MOVE_REFUSED",
                message: expect.stringContaining(message),
              }),
            ],
          },
        });
        await expect(preview(fields, moves, slug)).rejects.toThrow(refusal);
        await expect(save(t, fields, moves, slug)).rejects.toThrow(refusal);
        expect(await migrationFiles()).toEqual(files);
        expect(await definition()).toBe(stated);
        expect((await columnsOf(t, table)).sort()).toEqual(columns.sort());
        expect(await registryRow(t, slug)).toBe(registry);
      }

      it("a unique field, whose uniqueness a group's key cannot keep", async () => {
        const t = await boot(dialect);
        const code: Field = { name: "code", type: "text", unique: true };
        await createPosts(t, SLUG, { fields: [code, ...OUTSIDE] });
        await seed(t);
        const before = await readAll(t);
        await expectRefused(
          t,
          [...MOVED_FIELDS, group("meta", [NOTE, code])],
          [{ from: ["code"], to: ["meta", "code"] }],
          "cannot be kept unique"
        );
        expect(await readAll(t)).toEqual(before);
      });

      // Judged before the repeater: what stops it is the uniqueness its values would lose, which the
      // repeater's own "not available yet" would not say. At any depth, the repeater is named.
      it("a unique field into a repeater, and into a group inside one, naming the repeater", async () => {
        const t = await boot(dialect);
        const code: Field = { name: "code", type: "text", unique: true };
        const items = (fields: Field[]): Field => ({
          name: "items",
          type: "repeater",
          fields,
        });
        await createPosts(t, SLUG, {
          fields: [code, ...OUTSIDE, items([group("row", [NOTE])])],
        });
        await seed(t);
        const before = await readAll(t);
        const message =
          "code cannot be moved into the repeater items: a repeater keeps its values in one JSON value, which cannot be kept unique.";
        await expectRefused(
          t,
          [...OUTSIDE, items([code, group("row", [NOTE])])],
          [{ from: ["code"], to: ["items", "code"] }],
          message
        );
        await expectRefused(
          t,
          [...OUTSIDE, items([group("row", [NOTE, code])])],
          [{ from: ["code"], to: ["items", "row", "code"] }],
          message
        );
        expect(await readAll(t)).toEqual(before);
      });

      // Each entry may hold several rows, and one field keeps one value: the move is refused, no row
      // dropped, and a new field suggested.
      it("a field out of a repeater whose entries hold several rows", async () => {
        const t = await boot(dialect);
        const label: Field = { name: "label", type: "text" };
        const items = (fields: Field[]): Field => ({
          name: "items",
          type: "repeater",
          fields,
        });
        await createPosts(t, SLUG, {
          fields: [...OUTSIDE, items([label, NOTE])],
        });
        await t.nextly.create({
          collection: SLUG,
          data: {
            title: "Rows",
            slug: "rows",
            items: [
              { label: "First", note: "a" },
              { label: "Second", note: "b" },
            ],
          },
        });
        const before = await readAll(t);
        await expectRefused(
          t,
          [...OUTSIDE, label, items([NOTE])],
          [{ from: ["items", "label"], to: ["label"] }],
          "cannot be moved out of the repeating rows items: each entry may hold several rows of it, which one field cannot keep. Add a new field instead."
        );
        expect(await readAll(t)).toEqual(before);
      });

      it("a move into a group the same save creates", async () => {
        const t = await boot(dialect);
        await createPosts(t);
        await seed(t);
        const before = await readAll(t);
        const [summary, ...rest] = MOVED_FIELDS;
        await expectRefused(
          t,
          [...rest, group("meta", [NOTE]), group("extra", [summary as Field])],
          [{ from: ["summary"], to: ["extra", "summary"] }],
          "Save the new group first, then move the field into it."
        );
        expect(await readAll(t)).toEqual(before);
      });

      it("a move whose field the dialog's answer also renames", async () => {
        const t = await boot(dialect);
        await createPosts(t);
        await seed(t);
        const before = await readAll(t);
        const stated = await definition();
        const files = await migrationFiles();
        const [, ...rest] = MOVED_FIELDS;
        // `summary` moved into the group, and the dialog's drop-and-add pair answered as a rename
        // of `summary` to the new `subtitle`: the same column would be both copied and renamed.
        await expect(
          dispatchCollections(
            {} as ServiceContainer,
            "applySchemaChanges",
            { collectionName: SLUG },
            {
              fields: [
                { name: "subtitle", type: "text" },
                ...rest,
                group("meta", [NOTE, MOVED_FIELDS[0] as Field]),
              ],
              confirmed: true,
              schemaVersion: await versionOf(t, SLUG),
              hints: {
                moves: [{ from: ["summary"], to: ["meta", "summary"] }],
              },
              renameResolutions: [
                {
                  tableName: TABLE,
                  fromColumn: "summary",
                  toColumn: "subtitle",
                  choice: "rename",
                },
              ],
            }
          )
        ).rejects.toThrow(
          expect.objectContaining({
            publicData: {
              errors: [
                expect.objectContaining({
                  code: "FIELD_MOVE_REFUSED",
                  message: expect.stringContaining("also renamed"),
                }),
              ],
            },
          })
        );
        expect(await migrationFiles()).toEqual(files);
        expect(await definition()).toBe(stated);
        expect(await readAll(t)).toEqual(before);
      });

      it("a move out of a group the same save deletes", async () => {
        const t = await boot(dialect);
        await createPosts(t, SLUG, { fields: INSIDE });
        await expectRefused(
          t,
          [...MOVED_FIELDS],
          OUT.map(move => ({ ...move })),
          "Move the field out first, then delete the group."
        );
      });

      it("a date out of a group held in a form its column would not read as the same date, naming the entry", async () => {
        const t = await boot(dialect);
        await createPosts(t, SLUG, { fields: INSIDE });
        // Entry validation takes any date JavaScript can parse; SQLite's copy reads only ISO.
        const { item } = await t.nextly.create({
          collection: SLUG,
          data: {
            title: "Spelled",
            slug: "spelled",
            meta: { published: "July 17, 2026" },
          },
        });
        await t.nextly.create({
          collection: SLUG,
          data: {
            title: "Iso",
            slug: "iso",
            meta: { published: "2026-07-17T00:00:00.000Z" },
          },
        });
        const before = await readAll(t);
        await expectRefused(
          t,
          OUTSIDE,
          OUT,
          `1 entry holds a date for published its own column would not keep as the same date (${String((item as { id: unknown }).id)})`
        );
        expect(await readAll(t)).toEqual(before);
      });

      it("a field moved into a group that an enabled stored hook names", async () => {
        const t = await boot(dialect);
        await createPosts(t, SLUG, {
          hooks: [
            {
              hookId: "auto-slug",
              hookType: "beforeChange",
              enabled: true,
              config: { sourceField: "summary", targetField: "slug" },
              order: 0,
            },
          ],
        });
        await seed(t);
        const before = await readAll(t);
        await expectRefused(
          t,
          [
            ...MOVED_FIELDS.filter(field => field.name !== "summary"),
            group("meta", [NOTE, { name: "summary", type: "text" }]),
          ],
          [{ from: ["summary"], to: ["meta", "summary"] }],
          "summary is named by the Auto-generate Slug hook (sourceField), which reads and writes only top-level fields. Update the hook first, then move summary."
        );
        expect(await readAll(t)).toEqual(before);
      });

      it("a field moved out of a group onto the title every entry keeps while no field is named title", async () => {
        const t = await boot(dialect);
        const seoTitle: Field = { name: "title", type: "text" };
        await createPosts(t, SLUG, {
          fields: [group("meta", [NOTE, seoTitle])],
        });
        // The entry's own title, in the column the table keeps, and the group's title beside it.
        await t.nextly.create({
          collection: SLUG,
          data: { title: "Own", slug: "own", meta: { title: "Group" } },
        });
        const before = await readAll(t);
        expect(before.get("own")?.title).toBe("Own");
        await expectRefused(
          t,
          [seoTitle, group("meta", [NOTE])],
          [{ from: ["meta", "title"], to: ["title"] }],
          "Every entry already keeps its own title while no field is named title"
        );
        expect(await readAll(t)).toEqual(before);
      });

      // SQLite's text has no width, so a longer value is kept there.
      it.runIf(dialect !== "sqlite")(
        "a text out of a group longer than the width its column narrows to, naming that entry",
        async () => {
          const t = await boot(dialect);
          const headline = (maxLength: number): Field => ({
            name: "headline",
            type: "text",
            options: { variant: "short" },
            validation: { maxLength },
          });
          await createPosts(t, SLUG, {
            fields: [group("meta", [NOTE, headline(120)])],
          });
          const ids = new Map<string, string>();
          for (const [slug, text] of [
            ["long", "x".repeat(100)],
            ["fits", "y".repeat(40)],
          ] as const) {
            const { item } = await t.nextly.create({
              collection: SLUG,
              data: { title: slug, slug, meta: { headline: text } },
            });
            ids.set(slug, String((item as { id: unknown }).id));
          }
          const before = await readAll(t);
          // The width narrows from 120 to 40 as the field moves: varchar(40) on its new column.
          await expectRefused(
            t,
            [headline(40), group("meta", [NOTE])],
            [{ from: ["meta", "headline"], to: ["headline"] }],
            `1 entry holds a text for headline its own column would not keep as the same text (${ids.get("long")}). Write it in at most 40 characters, then move the field.`
          );
          expect(await readAll(t)).toEqual(before);
        }
      );

      // SQLite's numeric keeps a decimal's digits as they are.
      it.runIf(dialect !== "sqlite")(
        "a decimal out of a group with digits past its scale, which the cast would round, naming that entry",
        async () => {
          const t = await boot(dialect);
          const price: Field = {
            name: "price",
            type: "number",
            dbType: "decimal",
            precision: 10,
            scale: 2,
          };
          await createPosts(t, SLUG, {
            fields: [group("meta", [NOTE, price])],
          });
          const ids = new Map<string, string>();
          for (const [slug, value] of [
            ["rounded", 1.239],
            ["exact", 1.23],
            ["wide", 12345678.9],
          ] as const) {
            const { item } = await t.nextly.create({
              collection: SLUG,
              data: { title: slug, slug, meta: { price: value } },
            });
            ids.set(slug, String((item as { id: unknown }).id));
          }
          const before = await readAll(t);
          await expectRefused(
            t,
            [price, group("meta", [NOTE])],
            [{ from: ["meta", "price"], to: ["price"] }],
            `1 entry holds a number for price its own column would not keep as the same number (${ids.get("rounded")}). Write it as a number with at most 8 digits before the point and 2 after it, then move the field.`
          );
          expect(await readAll(t)).toEqual(before);
        }
      );

      it("a checkbox value out of a group that is neither true nor false, naming that entry", async () => {
        const t = await boot(dialect);
        await createPosts(t, SLUG, { fields: INSIDE });
        await t.nextly.create({
          collection: SLUG,
          data: { title: "Two", slug: "two" },
        });
        // Written as an entry may hold it, which the API would refuse: "yes" reads as false on
        // MySQL and SQLite and as true on PostgreSQL.
        await run(
          t,
          `UPDATE ${q(TABLE)} SET ${q("meta")} = '{"featured":"yes"}' WHERE ${q("slug")} = 'two'`
        );
        const [two] = await run<{ id: unknown }>(
          t,
          `SELECT ${q("id")} AS id FROM ${q(TABLE)} WHERE ${q("slug")} = 'two'`
        );
        const before = await readAll(t);
        await expectRefused(
          t,
          OUTSIDE,
          OUT,
          `1 entry holds a checkbox value for featured its own column would not keep as the same checkbox value (${String(two?.id)}). Write it as true or false, then move the field.`
        );
        expect(await readAll(t)).toEqual(before);
      });

      // SQLite's integer holds every whole number a JSON value from JavaScript can.
      it.runIf(dialect !== "sqlite")(
        "a number out of a group its integer column does not hold, naming only that entry",
        async () => {
          const t = await boot(dialect);
          await createPosts(t, SLUG, { fields: INSIDE });
          const ids = new Map<string, string>();
          for (const [slug, views] of [
            ["over", 2147483648],
            ["most", 2147483647],
            ["least", -2147483648],
          ] as const) {
            const { item } = await t.nextly.create({
              collection: SLUG,
              data: { title: slug, slug, meta: { views } },
            });
            ids.set(slug, String((item as { id: unknown }).id));
          }
          const before = await readAll(t);
          await expectRefused(
            t,
            OUTSIDE,
            OUT,
            `1 entry holds a number for views its own column would not keep as the same number (${ids.get("over")}). Write it as a whole number from -2147483648 to 2147483647, then move the field.`
          );
          expect(await readAll(t)).toEqual(before);
        }
      );

      it.runIf(dialect === "mysql")(
        "a date out of a group MySQL's TIMESTAMP column does not hold, or holds rounded, naming the entries",
        async () => {
          const t = await boot(dialect);
          await createPosts(t, SLUG, { fields: INSIDE });
          const ids: string[] = [];
          for (const [slug, published] of [
            ["early", "1960-01-01T00:00:00.000Z"],
            ["late", "2038-01-19T03:14:08.000Z"],
            // Inside the range, but with milliseconds its TIMESTAMP would round away.
            ["fraction", "2026-07-17T10:00:05.123Z"],
          ]) {
            const { item } = await t.nextly.create({
              collection: SLUG,
              data: { title: slug, slug, meta: { published } },
            });
            ids.push(String((item as { id: unknown }).id));
          }
          const before = await readAll(t);
          await expectRefused(
            t,
            OUTSIDE,
            OUT,
            `3 entries hold a date for published its own column would not keep as the same date (${ids.sort().join(", ")}). Write each as an ISO date in whole seconds, from 1970-01-01T00:00:01Z to 2038-01-19T03:14:07Z`
          );
          expect(await readAll(t)).toEqual(before);
        }
      );

      // Which save this refuses is the plan's own judgement, the same on every dialect.
      it.runIf(dialect === "sqlite")(
        "a field moved that also changes type",
        async () => {
          const t = await boot(dialect);
          await createPosts(t);
          await seed(t);
          const before = await readAll(t);
          await expectRefused(
            t,
            [
              ...MOVED_FIELDS.filter(field => field.name !== "views"),
              group("meta", [NOTE, { name: "views", type: "text" }]),
            ],
            [{ from: ["views"], to: ["meta", "views"] }],
            "views is moved and changes type, or how its values are stored, in the same save. Move it and make that change in separate saves."
          );
          expect(await readAll(t)).toEqual(before);
        }
      );

      // Every save of a translated collection is applied by the push today (`pushReasonOf`
      // answers "translated"), which would drop a moved column without copying it. Once saves
      // whose values only the push carries are the only ones it applies, this collection's move
      // takes its migration file, and this test is the one to change.
      it("a move in a translated collection, while the push applies all of its saves", async () => {
        const t = await boot(dialect);
        await createPosts(t, "gmv_tposts", { localized: true });
        await expectRefused(
          t,
          INSIDE,
          INTO,
          "Fields in a translated collection can't be moved yet.",
          "gmv_tposts"
        );
      });
    });
  }
);
