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
  await instance?.destroy();
  instance = undefined;
  vi.unstubAllEnvs();
  await rm(basePath, { recursive: true, force: true });
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

    it("through the Builder's schema dialog: in, then back out", async () => {
      const t = await boot(dialect);
      await createPosts(t);
      await seed(t);
      const before = await readAll(t);

      await save(t, INSIDE, INTO);

      const columns = await columnsOf(t);
      for (const name of MOVED) expect(columns).not.toContain(name);
      // An entry written into the group directly, with each entry's values as read before: the
      // moved entry reads as that one does, every kind of value in the form the API keeps it.
      for (const entry of ENTRIES) {
        const read = before.get(entry.slug);
        await t.nextly.create({
          collection: SLUG,
          data: {
            title: `${entry.title} direct`,
            slug: `${entry.slug}-direct`,
            meta: movedValues(read),
          },
        });
      }
      const inside = await readAll(t);
      for (const entry of ENTRIES) {
        expect(
          movedValues(inside.get(entry.slug)?.meta),
          `${entry.slug} in the group`
        ).toEqual(movedValues(inside.get(`${entry.slug}-direct`)?.meta));
        expect(movedValues(inside.get(entry.slug)?.meta)).toEqual(
          asJson(movedValues(before.get(entry.slug)))
        );
      }

      await save(t, OUTSIDE, OUT);

      const back = await columnsOf(t);
      for (const name of MOVED) expect(back).toContain(name);
      const outside = await readAll(t);
      for (const entry of ENTRIES) {
        expect(movedValues(outside.get(entry.slug)), entry.slug).toEqual(
          movedValues(before.get(entry.slug))
        );
        // Moved, not copied: the group no longer holds them.
        expect(
          Object.keys(
            (outside.get(entry.slug)?.meta ?? {}) as Record<string, unknown>
          ).filter(key => (MOVED as readonly string[]).includes(key))
        ).toEqual([]);
      }
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

    it("names what the moved column had that the group does not carry, in the review and the file", async () => {
      const t = await boot(dialect);
      const summary: Field = {
        name: "summary",
        type: "text",
        required: true,
        index: true,
      };
      await createPosts(t, SLUG, { fields: [summary, group("meta", [NOTE])] });
      // What a database may give a column besides what Nextly writes: a comment, and on MySQL a
      // collation of its own. SQLite keeps neither.
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
      expect(sentence).toContain("constraint NOT NULL");
      expect(sentence).toMatch(/: type \S+/);
      expect(sentence).toMatch(/index \S*summary\S*/);
      if (dialect !== "sqlite") {
        expect(sentence).toContain("comment Shown in lists");
      }
      if (dialect === "mysql") {
        expect(sentence).toContain("collation utf8mb4_bin");
        // The table's own character set is every column's; only one of the column's own is named.
        expect(sentence).not.toContain("character set");
      }

      await save(t, fields, into);

      const files = (await readdir(join(basePath, "migrations")))
        .filter(f => f.endsWith(".sql"))
        .sort();
      const written = await readFile(
        join(basePath, "migrations", files.at(-1) ?? ""),
        "utf-8"
      );
      expect(
        written
          .split("\n")
          .filter(line => line.startsWith("-- Deletes:"))
          .join("\n")
      ).toContain(sentence);
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

    describe("a move that cannot keep its values is refused before anything is written", () => {
      /** The save refused, in its review and in its apply, and nothing about the database changed. */
      async function expectRefused(
        t: TestNextly,
        fields: Field[],
        moves: { from: string[]; to: string[] }[],
        message: string,
        slug = SLUG
      ): Promise<void> {
        const files = await filesWritten();
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
        expect(await filesWritten()).toBe(files);
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
