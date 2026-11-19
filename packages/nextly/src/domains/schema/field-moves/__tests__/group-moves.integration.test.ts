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
  options: { fields?: Field[]; localized?: boolean } = {}
): Promise<void> {
  await t.getService("collectionService").createCollection(
    {
      name: slug,
      label: "Post",
      localized: options.localized ?? false,
      fields: options.fields ?? OUTSIDE,
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

    it("moves a date written at an offset out of a group as its instant, far from 1970 either way", async () => {
      const t = await boot(dialect);
      await createPosts(t, SLUG, { fields: INSIDE });
      const written = {
        early: "1960-01-01T10:00:00+05:00",
        late: "3500-01-01T10:00:00+05:00",
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
      ).toBe("1960-01-01T05:00:00.000Z");
      expect(
        new Date(moved.get("late")?.published as string).toISOString()
      ).toBe("3500-01-01T05:00:00.000Z");
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
          `1 entry holds a date for published in a form its own column would not read as the same date (${String((item as { id: unknown }).id)})`
        );
        expect(await readAll(t)).toEqual(before);
      });

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
