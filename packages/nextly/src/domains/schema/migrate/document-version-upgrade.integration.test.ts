/**
 * The per-document columns — the version counter and the last changer —
 * reach an existing site through `migrateCore`, the core of `nextly migrate`
 * and of both boot paths.
 *
 * The existing site is built through the product's own paths, one table of
 * every kind a document lives in: a code-first collection and Single, a Schema
 * Builder collection and Single, and the translation tables beside them. Then
 * the columns are taken off, which is what a database from before them looks
 * like, and rows are stamped with a fixed `updated_at`. The migrate must give
 * every existing document version 1 and no changer, rewrite no content and no
 * `updated_at`, finish a run that stopped part-way, and change nothing when
 * run again. A schema comparison must never see the columns at all, or the
 * site's next migration file would be refused as drift.
 *
 * @module domains/schema/migrate/document-version-upgrade.integration.test
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { FreshDatabase } from "../../../__tests__/helpers/fresh-database";
import { noMigrationsDir } from "../../../__tests__/helpers/migrate-core";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleEntryService } from "../../singles/services/single-entry-service";
import type { SingleMetadataService } from "../../singles/services/single-metadata-service";
import { migrateCore } from "../../../cli/commands/migrate";
import { ensureSchemaEventsTable } from "../events/schema-events-ddl";
import { diffSnapshots } from "../pipeline/diff/diff";
import { findColumnDifferences } from "../repair-columns/find-differences";
import { readRepairEntities } from "../repair-columns/read-entities";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";

import { addDocumentColumns } from "./document-columns";

const PER_DOCUMENT_COLUMNS = [
  "_revision",
  "_changed_by_kind",
  "_changed_by_id",
  "_changed_by_principal_kind",
  "_changed_at",
];

const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-docver-");

/** The app's migrations folder, below the instance's base path. */
const APP_MIGRATIONS = "migrations";
afterAll(remove);

// The Schema Builder runs the migration that creates a collection's tables
// only in development; elsewhere it records a pending one.
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
});

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  vi.unstubAllEnvs();
});

/** Every content table this site holds, by kind. */
const TABLES = {
  codeCollection: "dc_cf_posts",
  codeCollectionLanguages: "dc_cf_posts_locales",
  codeSingle: "single_cf_site",
  codeSingleLanguages: "single_cf_site_locales",
  // A code-first collection whose table is not named after its slug: found
  // through the registry, never rebuilt from the slug.
  renamed: "dc_custom_articles",
  builderCollection: "dc_ui_pages",
  builderCollectionLanguages: "dc_ui_pages_locales",
  builderSingle: "single_ui_banner",
} as const;

const ALL_TABLES = Object.values(TABLES);

// A field group's tables are no document of their own: the document holding
// it is versioned, never the group, so its tables get none of the columns and
// its reads must not ask for them.
const FIELD_GROUPS = [
  defineFieldGroup({ slug: "fg_plain", fields: [text({ name: "label" })] }),
  defineFieldGroup({
    slug: "fg_lang",
    localized: true,
    fields: [text({ name: "caption" })],
  }),
];

const COLLECTIONS = [
  defineCollection({
    slug: "cf_posts",
    localized: true,
    fields: [
      text({ name: "title", localized: true }),
      fieldGroup({ name: "plainBox", component: "fg_plain" }),
      fieldGroup({ name: "langBox", component: "fg_lang" }),
    ],
  }),
  defineCollection({
    slug: "cf_articles",
    dbName: "custom_articles",
    fields: [text({ name: "title" })],
  }),
];

const SINGLES = [
  defineSingle({
    slug: "cf_site",
    localized: true,
    fields: [text({ name: "siteName", localized: true })],
  }),
];

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    fieldGroups: FIELD_GROUPS,
    collections: COLLECTIONS,
    singles: SINGLES,
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    // Stated, so `migrationsOf` names the folder the instance's saves write to.
    db: { migrationsDir: APP_MIGRATIONS, uiSchemaFile: "./ui-schema.json" },
  });
  expect(current.adapter.dialect).toBe(dialect);
  return current;
}

/**
 * The app's migrations folder: where a Schema Builder save of this instance
 * writes its migration, and records it in the ledger as applied. `nextly
 * migrate` refuses a ledger naming files its folder lacks, so the upgrade runs
 * over this folder, as it would on the site.
 */
function migrationsOf(t: TestNextly): string {
  const dir = join(t.basePath, APP_MIGRATIONS);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function columnsOf(t: TestNextly, table: string): Promise<string[]> {
  const snapshot = await introspectLiveSnapshot(
    t.adapter.getDrizzle(),
    t.adapter.dialect as FreshDatabase["dialect"],
    [table]
  );
  return (
    snapshot.tables
      .find(spec => spec.name === table)
      ?.columns.map(column => column.name) ?? []
  );
}

/** Builds one table of every kind and writes a document into each. */
async function seed(t: TestNextly): Promise<void> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  const entries = handler.getEntryService();

  const builder = await handler.createCollection({
    name: "ui_pages",
    label: "Page",
    localized: true,
    fields: [{ name: "heading", type: "text" }],
  });
  expect(builder.success, JSON.stringify(builder)).toBe(true);
  const metadata = t.getService(
    "singleMetadataService"
  ) as SingleMetadataService;
  await metadata.createSingle({
    slug: "ui_banner",
    label: "Banner",
    tableName: TABLES.builderSingle,
    fields: [{ name: "message", type: "text" }],
    source: "ui",
    locked: false,
    schemaHash: "banner",
  } as never);

  for (const [slug, data] of [
    [
      "cf_posts",
      {
        title: "Hello",
        plainBox: { label: "Box" },
        langBox: { caption: "Caption" },
      },
    ],
    ["ui_pages", { heading: "Hi" }],
    ["cf_articles", { title: "Article" }],
  ] as const) {
    const created = await entries.createEntry(
      { collectionName: slug, overrideAccess: true, locale: "en" },
      data
    );
    expect(created.success, JSON.stringify(created)).toBe(true);
    if (slug === "cf_articles") continue;
    const id = String((created.data as { id: unknown }).id);
    await entries.updateEntry(
      {
        collectionName: slug,
        entryId: id,
        overrideAccess: true,
        locale: "es",
      },
      slug === "cf_posts"
        ? { title: "Hola", _overwrite: true }
        : { heading: "Hola", _overwrite: true }
    );
  }

  const singles = t.getService("singleEntryService") as SingleEntryService;
  await singles.update(
    "cf_site",
    { siteName: "Site", _overwrite: true },
    { locale: "en", overrideAccess: true }
  );
  await singles.update(
    "cf_site",
    { siteName: "Sitio", _overwrite: true },
    { locale: "es", overrideAccess: true }
  );
  await singles.update(
    "ui_banner",
    { message: "Welcome", _overwrite: true },
    { overrideAccess: true }
  );
}

const quote = (t: TestNextly, name: string) =>
  t.adapter.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/** A fixed moment, as each dialect stores a timestamp. */
const FIXED = (t: TestNextly) =>
  t.adapter.dialect === "sqlite" ? "1767225600" : "'2026-01-01 00:00:00'";

/**
 * Takes the per-document columns off `table`, as a database from before them
 * has it, keeping whichever of them `keep` names: a run stopped part-way
 * leaves some tables with all of them, some with none, and on a dialect that
 * commits each statement, a table with only some.
 */
async function strip(
  t: TestNextly,
  table: string,
  keep: readonly string[] = []
): Promise<void> {
  const present = await columnsOf(t, table);
  for (const column of PER_DOCUMENT_COLUMNS) {
    if (keep.includes(column) || !present.includes(column)) continue;
    await t.adapter.executeQuery(
      `ALTER TABLE ${quote(t, table)} DROP COLUMN ${quote(t, column)}`
    );
  }
}

/** Every row of every table, minus the per-document columns: the content. */
async function contentOf(t: TestNextly): Promise<string> {
  const out: Record<string, unknown[]> = {};
  for (const table of ALL_TABLES) {
    const rows = await rowsOf(t, table);
    out[table] = rows
      .map(row =>
        Object.fromEntries(
          Object.entries(row)
            .filter(([key]) => !PER_DOCUMENT_COLUMNS.includes(key))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => [
              key,
              value instanceof Date ? value.toISOString() : value,
            ])
        )
      )
      .map(row => JSON.stringify(row))
      .sort();
  }
  return JSON.stringify(out);
}

/**
 * Every row as stored, by a statement naming no column: the runtime model of
 * a table declares the per-document columns whether or not the table has
 * them yet, and a translation table's declares none of them.
 */
async function rowsOf(
  t: TestNextly,
  table: string
): Promise<Record<string, unknown>[]> {
  return t.adapter.executeQuery<Record<string, unknown>>(
    `SELECT * FROM ${quote(t, table)}`
  );
}

/** A logger for `migrateCore` that prints nothing. */
const silent = new Proxy(
  {},
  {
    get: (_target, name) =>
      name === "spinner" ? () => ({ stop: () => {} }) : () => {},
  }
) as Parameters<typeof migrateCore>[0]["logger"];

/**
 * `nextly migrate` with the app's own migration files, on the test's own
 * adapter: running a file needs the whole adapter. Every upgrade runs this way,
 * since the folder always holds the migrations the Builder save wrote.
 */
async function migrateWithFiles(t: TestNextly, dir: string): Promise<void> {
  await migrateCore({
    extensionSchema: undefined,
    dialect: t.adapter.dialect as FreshDatabase["dialect"],
    db: t.adapter.getDrizzle(),
    adapter: t.adapter as unknown as Parameters<
      typeof migrateCore
    >[0]["adapter"],
    migrationsDir: dir,
    logger: silent,
    lockMode: "fail-fast",
    withLock: async (_adapter, _dialect, fn) => ({
      ran: true,
      value: await fn(),
    }),
    ensureLedger: async () => {
      await ensureSchemaEventsTable(t.adapter);
    },
  });
}

/** Each registered entity's migration state and stored schema hash. */
async function registryState(
  t: TestNextly
): Promise<{ table: string; status: unknown; hash: unknown }[]> {
  const out: { table: string; status: unknown; hash: unknown }[] = [];
  for (const registry of ["dynamic_collections", "dynamic_singles"]) {
    for (const row of await rowsOf(t, registry)) {
      out.push({
        table: String(row.table_name),
        status: row.migration_status,
        hash: row.schema_hash,
      });
    }
  }
  return out.sort((a, b) => a.table.localeCompare(b.table));
}

/** An older site: every content table without the columns, rows dated. */
async function olderSite(t: TestNextly): Promise<void> {
  await seed(t);
  for (const table of ALL_TABLES) await strip(t, table);
  for (const table of [
    TABLES.codeCollection,
    TABLES.codeSingle,
    TABLES.renamed,
    TABLES.builderCollection,
    TABLES.builderSingle,
  ]) {
    await t.adapter.executeQuery(
      `UPDATE ${quote(t, table)} SET ${quote(t, "updated_at")} = ${FIXED(t)}`
    );
  }
  if (t.adapter.dialect === "mysql") {
    // A table an older release created with MySQL's own clock on it: any
    // UPDATE of its rows, a backfill included, would move `updated_at`.
    await t.adapter.executeQuery(
      `ALTER TABLE \`${TABLES.codeCollection}\` MODIFY \`updated_at\` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`
    );
  }
  for (const table of ALL_TABLES) {
    expect({ [table]: await columnsOf(t, table) }).not.toEqual({
      [table]: expect.arrayContaining(["_revision"]),
    });
  }
}

describe.each(getConfiguredTestDialects())(
  "the per-document columns through nextly migrate (%s)",
  dialect => {
    it("gives every existing document version 1 and no changer, and rewrites no content", async () => {
      const t = await boot(dialect);
      await olderSite(t);
      const before = await contentOf(t);

      await migrateWithFiles(t, migrationsOf(t));

      for (const table of ALL_TABLES) {
        expect({ [table]: await columnsOf(t, table) }).toEqual({
          [table]: expect.arrayContaining(PER_DOCUMENT_COLUMNS),
        });
        const rows = await rowsOf(t, table);
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect({
            table,
            revision: Number(row._revision),
            kind: row._changed_by_kind,
            id: row._changed_by_id,
            principal: row._changed_by_principal_kind,
            changedAt: row._changed_at,
          }).toEqual({
            table,
            revision: 1,
            kind: null,
            id: null,
            principal: null,
            // No time is known for a row from before the column.
            changedAt: null,
          });
        }
      }
      expect(await contentOf(t)).toBe(before);
    }, 240_000);

    it("a second run changes nothing", async () => {
      const t = await boot(dialect);
      await olderSite(t);
      await migrateWithFiles(t, migrationsOf(t));
      await t.adapter.executeQuery(
        `UPDATE ${quote(t, TABLES.builderSingle)} SET ${quote(t, "_revision")} = 7`
      );
      const before = await contentOf(t);

      expect(
        (
          await addDocumentColumns({
            db: t.adapter.getDrizzle(),
            dialect: t.adapter.dialect as FreshDatabase["dialect"],
          })
        ).added
      ).toBe(0);
      await migrateWithFiles(t, migrationsOf(t));

      expect(await contentOf(t)).toBe(before);
      expect(Number((await rowsOf(t, TABLES.builderSingle))[0]._revision)).toBe(
        7
      );
    }, 240_000);

    it("a run stopped part-way finishes on the next, keeping counters already there", async () => {
      const t = await boot(dialect);
      await seed(t);
      // What a run stopped after some statements leaves: one table done and
      // already counting, one with only some of the columns, the rest bare.
      await t.adapter.executeQuery(
        `UPDATE ${quote(t, TABLES.codeCollection)} SET ${quote(t, "_revision")} = 5`
      );
      await strip(t, TABLES.codeSingle, ["_revision", "_changed_by_kind"]);
      for (const table of ALL_TABLES) {
        if (table === TABLES.codeCollection || table === TABLES.codeSingle) {
          continue;
        }
        await strip(t, table);
      }
      const before = await contentOf(t);

      await migrateWithFiles(t, migrationsOf(t));

      for (const table of ALL_TABLES) {
        expect({ [table]: await columnsOf(t, table) }).toEqual({
          [table]: expect.arrayContaining(PER_DOCUMENT_COLUMNS),
        });
      }
      expect(
        (await rowsOf(t, TABLES.codeCollection)).map(r => Number(r._revision))
      ).toEqual([5]);
      expect(await contentOf(t)).toBe(before);
    }, 240_000);

    it("an insert that names none of the columns gets version 1 and no changer", async () => {
      const t = await boot(dialect);
      await olderSite(t);
      await migrateWithFiles(t, migrationsOf(t));

      // Code from before the upgrade, still serving while the migrate runs,
      // inserts without the new columns.
      await t.adapter.executeQuery(
        `INSERT INTO ${quote(t, TABLES.renamed)} (${quote(t, "id")}, ${quote(t, "title")}, ${quote(t, "slug")}) VALUES ('old-code', 'x', 'x')`
      );
      const inserted = (await rowsOf(t, TABLES.renamed)).find(
        row => row.id === "old-code"
      );
      expect([Number(inserted?._revision), inserted?._changed_by_id]).toEqual([
        1,
        null,
      ]);
    }, 240_000);

    it("a schema comparison never sees the columns, before the migrate or after", async () => {
      const t = await boot(dialect);
      await olderSite(t);
      const db = t.adapter.getDrizzle();
      const d = t.adapter.dialect as FreshDatabase["dialect"];
      const without = await introspectLiveSnapshot(db, d, [...ALL_TABLES]);

      await migrateWithFiles(t, migrationsOf(t));
      const withThem = await introspectLiveSnapshot(db, d, [...ALL_TABLES]);

      // A migration file's snapshots predate the columns while the live
      // database has them, and a file written after them has them while a
      // database not yet migrated does not. Either way the comparison that
      // decides drift, `migrate:create` and `migrate:check` must find
      // nothing, or the site's next file is refused as drift.
      expect(diffSnapshots(without, withThem)).toEqual([]);
      expect(diffSnapshots(withThem, without)).toEqual([]);
    }, 240_000);
    it("leaves no collection or Single awaiting a migration", async () => {
      // The columns reach existing tables through this step, not through the
      // schema version every entity's stored hash is built with: had that
      // moved, every entity on every site would read as changed and wait for
      // a migration no file carries.
      const t = await boot(dialect);
      await olderSite(t);
      const before = await registryState(t);

      await migrateWithFiles(t, migrationsOf(t));

      const after = await registryState(t);
      expect(after).toEqual(before);
      expect(after.filter(row => row.status === "pending")).toEqual([]);
    }, 240_000);

    it("reads field groups, translated and not, after the upgrade", async () => {
      const t = await boot(dialect);
      await olderSite(t);
      await migrateWithFiles(t, migrationsOf(t));

      const [post] = await rowsOf(t, TABLES.codeCollection);
      const read = (await t.nextly.findByID({
        collection: "cf_posts" as never,
        id: String(post.id),
        locale: "en",
        overrideAccess: true,
      } as never)) as Record<string, unknown>;
      expect(read.plainBox).toMatchObject({ label: "Box" });
      expect(read.langBox).toMatchObject({ caption: "Caption" });
      expect(read._rev).toBe("1.en:1");
    }, 240_000);
    it("a migration file written after the columns finds them already there", async () => {
      // A file generated once the columns exist may name them: a SQLite table
      // rebuild copies every column the table has. The step therefore runs
      // before the app's files as well as after them; after alone, the file
      // would fail on an existing site that has not had them added yet.
      const t = await boot(dialect);
      await olderSite(t);
      // Written beside the save's migrations, named after them, as the app's
      // next file would be.
      const dir = migrationsOf(t);
      writeFileSync(
        join(dir, "29991231_000000_000_reads_versions.sql"),
        `UPDATE ${TABLES.codeCollection} SET _revision = _revision WHERE 1 = 0;\n`
      );
      await migrateWithFiles(t, dir);
      expect(await columnsOf(t, TABLES.codeCollection)).toEqual(
        expect.arrayContaining(PER_DOCUMENT_COLUMNS)
      );
    }, 240_000);
    it("leaves repair-columns nothing to report about the columns", async () => {
      // The comparison judges the columns fields name, and these are no
      // field's: it must never report them as a difference on an upgraded
      // site, however it comes to read the live tables.
      const t = await boot(dialect);
      await olderSite(t);
      await migrateWithFiles(t, migrationsOf(t));

      const entities = await readRepairEntities({
        adapter: t.adapter as never,
        dialect: t.adapter.dialect as FreshDatabase["dialect"],
        config: {
          collections: COLLECTIONS,
          singles: SINGLES,
          fieldGroups: FIELD_GROUPS,
          db: { uiSchemaFile: "ui-schema.json" },
        },
        projectRoot: NO_MIGRATIONS,
        migrationsDir: NO_MIGRATIONS,
        logger: silent as never,
      });
      const findings = await findColumnDifferences({
        db: t.adapter.getDrizzle(),
        dialect: t.adapter.dialect as FreshDatabase["dialect"],
        entities,
      });
      expect(
        findings.filter(finding =>
          PER_DOCUMENT_COLUMNS.includes(finding.location.column)
        )
      ).toEqual([]);
    }, 240_000);
  }
);
