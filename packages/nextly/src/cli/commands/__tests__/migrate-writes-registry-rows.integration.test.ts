/**
 * `nextly migrate` brings each registry row the newest applied snapshot
 * records to that record, under the schema lock and after its migrations
 * apply, on every configured dialect. No start runs here: the instance
 * declares no entity of its own, so every registry row a test finds was
 * written by the command.
 *
 * The commands are driven themselves (`runMigrateCreate`, `runMigrate`)
 * against a project directory and a database of the test's own; only the
 * config file is not read from disk, the loader is handed what each step
 * declares.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  defineSingle,
  number,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { CollectionRegistryService } from "../../../domains/collections/services/collection-registry-service";
import { loadedDialect } from "../../../database/dialect-tables";
import { container } from "../../../di/container";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { withMigrateLock } from "../../../domains/schema/pipeline/locks";
import { mutateManifest } from "../../../domains/schema/ui-schema/mutate";
import { uiSchemaManifest } from "../../../schemas/_zod/ui-schema";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  installTagExpiryLedger,
  withdrawTagExpiryLedger,
} from "../../../runtime/cache/ledger-wiring";
import { tagExpiryLedgerPublished } from "../../../runtime/cache/tag-expiry-view";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";
import { runMigrateDown } from "../migrate-down";

/** The config the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let clock = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-registry-rows-"));
  mkdirSync(join(dir, "migrations"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  // Each migration file is named by the clock; two runs inside one
  // millisecond would otherwise write the same name.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 10, 12, 0, 0, 0)));
});

afterEach(async () => {
  vi.useRealTimers();
  await instance?.destroy();
  instance = undefined;
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A booted instance the commands reach through `DATABASE_URL`. SQLite runs on
 * a file in the test's directory, since an in-memory database is
 * unreachable from the commands' connection.
 */
async function boot(dialect: TestDialect): Promise<TestNextly> {
  if (dialect !== "sqlite") return createTestNextly({ dialect });
  const url = `file:${join(dir, "test.db")}`;
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = url;
  _resetEnvCache();
  const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
    typeof createAdapter
  >[0]);
  return createTestNextly({ adapter });
}

/** A command's context, with everything it says captured. */
function command(): { context: CommandContext; said: string[] } {
  const said: string[] = [];
  const base = createLogger({ quiet: true });
  const capture = (message: string) => {
    said.push(message);
  };
  return {
    context: {
      logger: {
        ...base,
        info: capture,
        warn: capture,
        success: capture,
        error: capture,
      },
      options: {},
      cwd: dir,
    } as CommandContext,
    said,
  };
}

/** Run `fn`, turning `process.exit` into the code it was called with. */
async function exiting(fn: () => Promise<void>): Promise<number | undefined> {
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await fn();
    return undefined;
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return Number(match[1]);
    throw error;
  } finally {
    exit.mockRestore();
  }
}

/** Moves the clock on, so a migration file and a row write each get a time of their own. */
function tick(): void {
  clock += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 10, 12, 0, clock, 0)));
}

/**
 * `nextly migrate:create --name=<name> --non-interactive` over `config`, at
 * the next tick of the clock, or at `at`, which names the file by that time.
 * Where nobody can be asked, a file that deletes data (a dropped table, a
 * changed type) is written only under consent, which `consent` gives.
 */
async function migrateCreate(
  config: unknown,
  name: string,
  at?: Date,
  consent: { acceptDataLoss?: boolean } = {}
): Promise<string> {
  loaded.config = config;
  if (at === undefined) tick();
  else vi.setSystemTime(at);
  const { context, said } = command();
  setNonInteractive(true);
  const code = await exiting(() =>
    runMigrateCreate(name, { cwd: dir, ...consent }, context)
  ).finally(() => setNonInteractive(false));
  expect(code, said.join("\n")).toBeUndefined();
  const file = readdirSync(join(dir, "migrations")).find(f =>
    f.endsWith(`_${name}.sql`)
  );
  expect(file, `no migration named ${name}`).toBeDefined();
  return file!;
}

/** `nextly migrate` over `config`, with its exit code and what it said. */
async function migrate(
  config: unknown,
  consent: { acceptDataLoss?: boolean } = {}
): Promise<{ code: number | undefined; said: string[] }> {
  loaded.config = config;
  tick();
  const { context, said } = command();
  const code = await exiting(() =>
    runMigrate({ cwd: dir, ...consent }, context)
  );
  return { code, said };
}

/** `nextly migrate`, which must succeed. */
async function migrated(
  config: unknown,
  consent: { acceptDataLoss?: boolean } = {}
): Promise<void> {
  const { code, said } = await migrate(config, consent);
  expect(code, said.join("\n")).toBeUndefined();
}

/**
 * `run`, a `nextly migrate:down`, as its own process runs it: with none of the booted instance's
 * services and no tag expiry ledger of its own published, all put back afterwards whatever `run`
 * did.
 *
 * The command opens its own connection and lends its own services on it (`withCommandServicesLent`),
 * but a name the process registered already, and a ledger already published, stay the process's.
 * Here those are the booted instance's, on a second connection: on SQLite a grants write inside the
 * DOWN's transaction reached them and waited behind the transaction's own write lock. A real
 * `migrate:down` is a process of its own with nothing registered, and a development start's migrate
 * runs on the instance's one adapter, so neither has a second connection to wait on.
 */
async function asItsOwnProcess<T>(run: () => Promise<T>): Promise<T> {
  const booted = container.detach();
  const ledgerWasPublished = tagExpiryLedgerPublished();
  if (ledgerWasPublished) withdrawTagExpiryLedger();
  try {
    return await run();
  } finally {
    container.restore(booted);
    if (ledgerWasPublished) {
      installTagExpiryLedger(instance!.adapter as unknown as DrizzleAdapter);
    }
  }
}

/** `nextly migrate:down --step <step>`, consenting to what it deletes, which must succeed. */
async function migratedDown(config: unknown, step = 1): Promise<void> {
  loaded.config = config;
  tick();
  const { context, said } = command();
  setNonInteractive(true);
  const code = await asItsOwnProcess(() =>
    exiting(() =>
      runMigrateDown({ cwd: dir, step, acceptDataLoss: true }, context)
    )
  ).finally(() => setNonInteractive(false));
  expect(code, said.join("\n")).toBeUndefined();
}

/** The project's `ui-schema.json`, as the Builder leaves it. */
async function writeManifest(manifest: unknown): Promise<void> {
  await writeFile(
    join(dir, "ui-schema.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

/**
 * Put `statement` into a migration file, as the first statement of its DOWN
 * or the last of its UP, so a test sees what the database holds at that point
 * of a run.
 */
async function insertStatement(
  file: string,
  section: "up-last" | "down-first",
  statement: string
): Promise<void> {
  const path = join(dir, "migrations", file);
  const sql = await readFile(path, "utf-8");
  const edited =
    section === "up-last"
      ? sql.replace(
          /(-- DOWN)/,
          `--> statement-breakpoint\n${statement};\n\n$1`
        )
      : sql.replace(
          /(-- DOWN\s*\n)/,
          `$1${statement};\n--> statement-breakpoint\n`
        );
  expect(edited, `no section to put the statement in ${file}`).not.toBe(sql);
  await writeFile(path, edited);
}

/**
 * `fn` as a run under `next dev` sees it: `NODE_ENV=development` and the live
 * sync not turned off, which is how a hand-run `nextly migrate` with no
 * `NODE_ENV` reads too, since the command sets development itself.
 */
async function inDevelopment<T>(fn: () => Promise<T>): Promise<T> {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NEXTLY_DISABLE_HMR", undefined);
  try {
    return await fn();
  } finally {
    vi.unstubAllEnvs();
  }
}

/**
 * `fn` as a production `nextly migrate` runs it, with the two settings a
 * production environment requires set to placeholders.
 */
async function inProduction<T>(fn: () => Promise<T>): Promise<T> {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXTLY_SECRET", "x".repeat(32));
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  _resetEnvCache();
  try {
    return await fn();
  } finally {
    vi.unstubAllEnvs();
    _resetEnvCache();
  }
}

type Row = Record<string, unknown>;
interface Selecting {
  select: () => { from: (table: unknown) => Promise<Row[]> };
  update: (table: unknown) => {
    set: (values: Row) => { where: (condition: unknown) => Promise<unknown> };
  };
  delete: (table: unknown) => {
    where: (condition: unknown) => Promise<unknown>;
  };
}

/** The collection registry row of `slug`, or undefined. */
async function collectionRow(
  t: TestNextly,
  dialect: TestDialect,
  slug: string
): Promise<Row | undefined> {
  const db = (t.adapter as unknown as DrizzleAdapter).getDrizzle<Selecting>();
  const { tables } = loadedDialect(dialect);
  const rows = await db.select().from(tables.dynamicCollections);
  return rows.find(row => row.slug === slug);
}

/** Every registry row of each kind, as stored. */
async function registryRows(
  t: TestNextly,
  dialect: TestDialect
): Promise<Record<"collections" | "singles" | "fieldGroups", Row[]>> {
  const db = (t.adapter as unknown as DrizzleAdapter).getDrizzle<Selecting>();
  const { tables } = loadedDialect(dialect);
  return {
    collections: await db.select().from(tables.dynamicCollections),
    singles: await db.select().from(tables.dynamicSingles),
    fieldGroups: await db.select().from(tables.dynamicFieldGroups),
  };
}

/** Columns that are each writer's own rather than the declaration's. */
const OWN_COLUMNS = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "createdBy",
  "source",
  "locked",
  "configPath",
  "migrationStatus",
  "schemaVersion",
  "lastMigrationId",
]);

/** The columns the declaration of `slug` decides, JSON read as values. */
function declaredColumns(
  rows: Row[],
  slug: string
): Record<string, unknown> | undefined {
  const row = rows.find(candidate => candidate.slug === slug);
  if (row === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(row)
      .filter(([column]) => !OWN_COLUMNS.has(column))
      .map(([column, value]) => [
        column,
        typeof value === "string" && /^[[{]/.test(value)
          ? JSON.parse(value)
          : value,
      ])
  );
}

/** The field names a row records, in order. */
function fieldNames(row: Row | undefined): string[] {
  const raw = row?.fields;
  const fields = (typeof raw === "string" ? JSON.parse(raw) : raw) as
    | { name: string }[]
    | undefined;
  return (fields ?? []).map(field => field.name);
}

/** A field's type, as the row records it. */
function fieldType(row: Row | undefined, name: string): unknown {
  const raw = row?.fields;
  const fields = (typeof raw === "string" ? JSON.parse(raw) : raw) as
    | { name: string; type: string }[]
    | undefined;
  return fields?.find(field => field.name === name)?.type;
}

/** A field's admin settings, as the row records them. */
function fieldAdmin(
  row: Row | undefined,
  name: string
): Record<string, unknown> | undefined {
  const raw = row?.fields;
  const fields = (typeof raw === "string" ? JSON.parse(raw) : raw) as
    | { name: string; admin?: Record<string, unknown> }[]
    | undefined;
  return fields?.find(field => field.name === name)?.admin;
}

/** The registry row of `slug` among `kind`'s rows, or undefined. */
async function rowOf(
  t: TestNextly,
  dialect: TestDialect,
  kind: "collections" | "singles" | "fieldGroups",
  slug: string
): Promise<Row | undefined> {
  return (await registryRows(t, dialect))[kind].find(row => row.slug === slug);
}

const posts = (description: string, ...extra: ReturnType<typeof text>[]) =>
  defineConfig({
    collections: [
      defineCollection({
        slug: "rr_posts",
        description,
        fields: [text({ name: "title" }), ...extra],
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });

describe.each(getConfiguredTestDialects())(
  "nextly migrate writes the registry rows from the migrations (%s)",
  dialect => {
    const q = dialect === "mysql" ? "`" : '"';

    beforeEach(async () => {
      instance = await boot(dialect);
    });

    it("writes a field added in code before any start, and nothing on a second run", async () => {
      await migrateCreate(posts("Posts"), "create_posts");
      await migrated(posts("Posts"));
      expect(
        fieldNames(await collectionRow(instance!, dialect, "rr_posts"))
      ).toEqual(expect.arrayContaining(["title"]));

      const withBody = posts("Posts", text({ name: "body" }));
      await migrateCreate(withBody, "add_body");
      await migrated(withBody);
      const written = await collectionRow(instance!, dialect, "rr_posts");
      expect(fieldNames(written)).toEqual(
        expect.arrayContaining(["title", "body"])
      );

      // A row that already matches is written to not at all.
      await migrated(withBody);
      expect(await collectionRow(instance!, dialect, "rr_posts")).toEqual(
        written
      );
    });

    // A Builder entity's row is first written by its migration's own upsert.
    // Read as that upsert reads the declaration, the row then matches, so a
    // run with nothing pending writes nothing, and restores a hand edit.
    it("brings a Builder entity's row to its record, and writes nothing where it matches", async () => {
      const builderOnly = defineConfig({
        collections: [],
        db: { migrationsDir: "./migrations" },
      });
      await writeFile(
        join(dir, "ui-schema.json"),
        `${JSON.stringify(
          uiSchemaManifest.parse({
            collections: [
              {
                slug: "rr_events",
                description: "Things that happen",
                // The Builder's own spellings of these settings, which its
                // upsert resolves differently from a config entry's.
                versions: true,
                versionsMaxPerDoc: 5,
                revalidate: true,
                webhooks: false,
                fields: [{ name: "title", type: "text" }],
              },
            ],
          }),
          null,
          2
        )}\n`
      );
      await migrateCreate(builderOnly, "create_events");
      await migrated(builderOnly);
      const written = await collectionRow(instance!, dialect, "rr_events");
      expect(written?.description).toBe("Things that happen");
      // The Builder's settings as its own upsert resolves them: five versions
      // kept, and its revalidation switch stored as the Builder stores it.
      // A row rewritten through a config entry's projection loses both.
      const stored = (value: unknown) =>
        typeof value === "string" ? JSON.parse(value) : value;
      expect(stored(written?.versions)).toMatchObject({ maxPerDoc: 5 });
      expect(stored(written?.revalidate)).toBeNull();

      await migrated(builderOnly);
      expect(await collectionRow(instance!, dialect, "rr_events")).toEqual(
        written
      );

      const db = (
        instance!.adapter as unknown as DrizzleAdapter
      ).getDrizzle<Selecting>();
      const { tables } = loadedDialect(dialect);
      const { eq } = await import("drizzle-orm");
      await db
        .update(tables.dynamicCollections)
        .set({ description: "edited by hand" })
        .where(eq(tables.dynamicCollections.slug, "rr_events"));
      await migrated(builderOnly);
      expect(
        (await collectionRow(instance!, dialect, "rr_events"))?.description
      ).toBe("Things that happen");
    });

    it("writes a field added in code to a Single's and a field group's rows", async () => {
      const declared = (...extra: ReturnType<typeof text>[]) =>
        defineConfig({
          collections: [],
          singles: [
            defineSingle({
              slug: "rr_site",
              fields: [text({ name: "tagline" }), ...extra],
            }),
          ],
          fieldGroups: [
            defineFieldGroup({
              slug: "rr_hero",
              fields: [text({ name: "heading" }), ...extra],
            }),
          ],
          db: { migrationsDir: "./migrations" },
        });
      await migrateCreate(declared(), "create_site");
      await migrated(declared());
      const withNote = declared(text({ name: "note" }));
      await migrateCreate(withNote, "add_note");
      await migrated(withNote);

      const { tables } = loadedDialect(dialect);
      const db = (
        instance!.adapter as unknown as DrizzleAdapter
      ).getDrizzle<Selecting>();
      const site = (await db.select().from(tables.dynamicSingles)).find(
        row => row.slug === "rr_site"
      );
      const hero = (await db.select().from(tables.dynamicFieldGroups)).find(
        row => row.slug === "rr_hero"
      );
      // A Single also holds the system fields `defineSingle` adds.
      expect(fieldNames(site)).toEqual(
        expect.arrayContaining(["tagline", "note"])
      );
      expect(fieldNames(hero)).toEqual(
        expect.arrayContaining(["heading", "note"])
      );
    });

    // One declaration, two paths: `nextly migrate` from the snapshot on this
    // instance, a start syncing the same entries on a second one. Every
    // column the declaration decides must come out the same, or the two
    // rewrite each other's rows on every run. Where a row came from (source,
    // lock, config path), its id and times, and its migration bookkeeping are
    // each writer's own and left out.
    it("writes each code-first row as a start writes it", async () => {
      const collection = defineCollection({
        slug: "rr_par_posts",
        description: "Posts",
        labels: { singular: "Entry", plural: "Entries" },
        admin: { group: "Content" },
        status: true,
        fields: [
          // A field setting the schema hash omits, which both paths store.
          text({ name: "title", admin: { description: "The headline" } }),
          number({ name: "rank" }),
        ],
      });
      const single = defineSingle({
        slug: "rr_par_site",
        description: "The site",
        fields: [text({ name: "tagline" })],
      });
      const fieldGroup = defineFieldGroup({
        slug: "rr_par_hero",
        description: "A hero block",
        fields: [text({ name: "heading" })],
      });
      const declared = defineConfig({
        collections: [collection],
        singles: [single],
        fieldGroups: [fieldGroup],
        db: { migrationsDir: "./migrations" },
      });
      await migrateCreate(declared, "create_parity");
      await migrated(declared);
      const fromMigrate = await registryRows(instance!, dialect);

      const started = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [collection],
        singles: [single],
        fieldGroups: [fieldGroup],
      });
      try {
        const fromStart = await registryRows(started, dialect);
        for (const [kind, slug] of [
          ["collections", "rr_par_posts"],
          ["singles", "rr_par_site"],
          ["fieldGroups", "rr_par_hero"],
        ] as const) {
          const migrated = declaredColumns(fromMigrate[kind], slug);
          expect(migrated, `${kind} ${slug} from migrate`).toBeDefined();
          expect(migrated, `${kind} ${slug}`).toEqual(
            declaredColumns(fromStart[kind], slug)
          );
        }
      } finally {
        await started.destroy();
      }
    });

    // Under `next dev` a live sync keeps the rows in step with the code as it
    // is edited, ahead of any migration, so a hand run there puts nothing
    // back to the snapshot. The control is the same run outside development,
    // which restores the row (below).
    it("rewrites no row in development, where a live sync keeps them", async () => {
      await migrateCreate(posts("Posts"), "create_posts");
      await migrated(posts("Posts"));
      const db = (
        instance!.adapter as unknown as DrizzleAdapter
      ).getDrizzle<Selecting>();
      const { tables } = loadedDialect(dialect);
      const { eq } = await import("drizzle-orm");
      await db
        .update(tables.dynamicCollections)
        .set({ description: "synced from the code" })
        .where(eq(tables.dynamicCollections.slug, "rr_posts"));

      vi.stubEnv("NODE_ENV", "development");
      try {
        await migrated(posts("Posts"));
      } finally {
        vi.unstubAllEnvs();
      }
      expect(
        (await collectionRow(instance!, dialect, "rr_posts"))?.description
      ).toBe("synced from the code");
    });

    // A run in development adds the rows a fresh database lacks, from the
    // migrations it applies: nothing else writes them on a site whose start
    // syncs no rows.
    it("writes every row on a fresh database in development", async () => {
      const declared = defineConfig({
        collections: [
          defineCollection({
            slug: "rr_posts",
            description: "Posts",
            fields: [text({ name: "title" })],
          }),
        ],
        singles: [
          defineSingle({
            slug: "rr_site",
            fields: [text({ name: "tagline" })],
          }),
        ],
        fieldGroups: [
          defineFieldGroup({
            slug: "rr_hero",
            fields: [text({ name: "heading" })],
          }),
        ],
        db: { migrationsDir: "./migrations" },
      });
      await migrateCreate(declared, "create_all");
      await inDevelopment(() => migrated(declared));

      const rows = await registryRows(instance!, dialect);
      expect(rows.collections.map(row => row.slug)).toContain("rr_posts");
      expect(rows.singles.map(row => row.slug)).toContain("rr_site");
      expect(rows.fieldGroups.map(row => row.slug)).toContain("rr_hero");
      expect(
        fieldNames(rows.collections.find(row => row.slug === "rr_posts"))
      ).toContain("title");
    });

    // The migration a development run applies changed the entity's table, so
    // its row is brought to the migration's record, field and all.
    it("writes the row of an entity a migration applied in development changes", async () => {
      await migrateCreate(posts("Posts"), "create_posts");
      await migrated(posts("Posts"));
      const withBody = posts("Posts", text({ name: "body" }));
      await migrateCreate(withBody, "add_body");
      await inDevelopment(() => migrated(withBody));

      expect(
        fieldNames(await collectionRow(instance!, dialect, "rr_posts"))
      ).toEqual(expect.arrayContaining(["title", "body"]));
    });

    // The rows a migration's change owes are owed until they are written, not
    // only during the run that applied it: the stored schema version names
    // the newest migration whose rows are written, so a run after a failed
    // write still writes them.
    it("writes, on a later run in development, the row a failed write left behind", async () => {
      await migrateCreate(posts("Posts"), "create_posts");
      await migrated(posts("Posts"));
      const withBody = posts("Posts", text({ name: "body" }));
      await migrateCreate(withBody, "add_body");

      const write = vi
        .spyOn(CollectionRegistryService.prototype, "writeRecordedCollection")
        .mockRejectedValueOnce(new Error("the registry write failed"));
      try {
        await inDevelopment(() => migrate(withBody));
      } finally {
        write.mockRestore();
      }
      // The file applied; its row was not written.
      expect(
        fieldNames(await collectionRow(instance!, dialect, "rr_posts"))
      ).not.toContain("body");

      await inDevelopment(() => migrated(withBody));
      expect(
        fieldNames(await collectionRow(instance!, dialect, "rr_posts"))
      ).toEqual(expect.arrayContaining(["title", "body"]));
    });

    // Only the entities the applied migration changes: another entity's row,
    // edited by a live sync with no migration for the edit, is left as it is.
    it("leaves a synced row in development while a migration for another entity applies", async () => {
      const declared = (...extra: ReturnType<typeof text>[]) =>
        defineConfig({
          collections: [
            defineCollection({
              slug: "rr_posts",
              description: "Posts",
              fields: [text({ name: "title" }), ...extra],
            }),
            defineCollection({
              slug: "rr_tags",
              description: "Tags",
              fields: [text({ name: "label" })],
            }),
          ],
          db: { migrationsDir: "./migrations" },
        });
      await migrateCreate(declared(), "create_both");
      await migrated(declared());
      const db = (
        instance!.adapter as unknown as DrizzleAdapter
      ).getDrizzle<Selecting>();
      const { tables } = loadedDialect(dialect);
      const { eq } = await import("drizzle-orm");
      await db
        .update(tables.dynamicCollections)
        .set({ description: "synced from the code" })
        .where(eq(tables.dynamicCollections.slug, "rr_tags"));

      const withBody = declared(text({ name: "body" }));
      await migrateCreate(withBody, "add_body");
      await inDevelopment(() => migrated(withBody));

      expect(
        fieldNames(await collectionRow(instance!, dialect, "rr_posts"))
      ).toEqual(expect.arrayContaining(["title", "body"]));
      expect(
        (await collectionRow(instance!, dialect, "rr_tags"))?.description
      ).toBe("synced from the code");
    });

    // A migration named before the one the stored version names (from a
    // parallel branch) applies after it, where the later ones changed no
    // table. The newest applied snapshot is the later one's, which lacks its
    // change, so its entity's row is not written from it; the next
    // `migrate:create` records the merged state in a migration named after
    // the version, whose rows a development run then writes.
    it("writes, in development, the change of a migration named before the version once the merge is recorded", async () => {
      const declared = (
        postsDescription: string,
        ...tagFields: ReturnType<typeof text>[]
      ) =>
        defineConfig({
          collections: [
            defineCollection({
              slug: "rr_posts",
              description: postsDescription,
              fields: [text({ name: "title" })],
            }),
            defineCollection({
              slug: "rr_tags",
              description: "Tags",
              fields: [text({ name: "label" }), ...tagFields],
            }),
          ],
          db: { migrationsDir: "./migrations" },
        });
      await migrateCreate(declared("Posts"), "create_both");
      const created = clock;
      await migrated(declared("Posts"));
      // A settings-only change, named and applied first: the version names it.
      await migrateCreate(declared("Articles"), "describe_posts");
      await inDevelopment(() => migrated(declared("Articles")));

      // Named half a second after `create_both`, so before `describe_posts`.
      const merged = declared("Articles", text({ name: "color" }));
      const parallel = await migrateCreate(
        merged,
        "add_color",
        new Date(Date.UTC(2026, 10, 10, 12, 0, created, 500))
      );
      const named = () =>
        readdirSync(join(dir, "migrations"))
          .filter(file => file.endsWith(".sql"))
          .sort();
      expect(named().indexOf(parallel)).toBe(1);
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 10, 12, 0, clock, 0)));
      await inDevelopment(() => migrated(merged));
      expect(
        fieldNames(await collectionRow(instance!, dialect, "rr_tags"))
      ).not.toContain("color");

      const record = await migrateCreate(merged, "record_merge");
      expect(named().at(-1)).toBe(record);
      await inDevelopment(() => migrated(merged));
      expect(
        fieldNames(await collectionRow(instance!, dialect, "rr_tags"))
      ).toEqual(["title", "slug", "label", "color"]);
    });

    /**
     * A template's hand-written migration, as the blog template ships one: SQL
     * creating a collection's and a Single's tables, beside a snapshot that
     * lists them in the older shape (`collections`/`singles`, no
     * `migrationHash` or `entities`).
     */
    async function writeOlderFormatMigration(): Promise<void> {
      // MySQL keys no TEXT column without a length.
      const id = dialect === "mysql" ? "varchar(36)" : "text";
      await writeFile(
        join(dir, "migrations", "0001_000000_legacy.sql"),
        [
          "-- UP",
          `CREATE TABLE ${q}dc_rr_legacy${q} (${q}id${q} ${id} PRIMARY KEY, ${q}title${q} text);`,
          `CREATE TABLE ${q}single_rr_legacy_site${q} (${q}id${q} ${id} PRIMARY KEY, ${q}tagline${q} text);`,
          "",
          "-- DOWN",
          `DROP TABLE ${q}single_rr_legacy_site${q};`,
          `DROP TABLE ${q}dc_rr_legacy${q};`,
          "",
        ].join("\n")
      );
      mkdirSync(join(dir, "migrations", "meta"), { recursive: true });
      await writeFile(
        join(dir, "migrations", "meta", "0001_000000_legacy.snapshot.json"),
        JSON.stringify({
          version: 1,
          template: "blog",
          collections: [
            {
              slug: "rr_legacy",
              tableName: "dc_rr_legacy",
              fields: [{ name: "title", type: "text" }],
            },
          ],
          singles: [
            {
              slug: "rr_legacy_site",
              tableName: "single_rr_legacy_site",
              fields: [{ name: "tagline", type: "text" }],
            },
          ],
        })
      );
    }

    /** The slugs of the rows the older-format snapshot lists that the registry holds. */
    async function olderFormatRows(): Promise<string[]> {
      const rows = await registryRows(instance!, dialect);
      return [
        ...rows.collections.map(row => row.slug),
        ...rows.singles.map(row => row.slug),
      ]
        .filter(slug => String(slug).startsWith("rr_legacy"))
        .map(String)
        .sort();
    }

    const noEntities = defineConfig({
      collections: [],
      db: { migrationsDir: "./migrations" },
    });

    // The rows its snapshot lists are added in development, as they always were.
    it("adds the rows an older-format snapshot lists in development", async () => {
      await writeOlderFormatMigration();
      await inDevelopment(() => migrated(noEntities));
      expect(await olderFormatRows()).toEqual(["rr_legacy", "rr_legacy_site"]);
      expect(
        fieldNames(await collectionRow(instance!, dialect, "rr_legacy"))
      ).toContain("title");
    });

    // And outside development, where nothing else would add them once a
    // production start syncs no rows: the newest applied snapshot is in the
    // older shape, not unreadable, so its rows are added where absent.
    it("adds the rows an older-format snapshot lists in production", async () => {
      await writeOlderFormatMigration();
      await inProduction(() => migrated(noEntities));
      expect(await olderFormatRows()).toEqual(["rr_legacy", "rr_legacy_site"]);

      // A later run, past the first, adds one gone missing: an install whose
      // first run on this release wrote none of them gets them on its next.
      const db = (
        instance!.adapter as unknown as DrizzleAdapter
      ).getDrizzle<Selecting>();
      const { tables } = loadedDialect(dialect);
      const { eq } = await import("drizzle-orm");
      await db
        .delete(tables.dynamicCollections)
        .where(eq(tables.dynamicCollections.slug, "rr_legacy"));
      await inProduction(() => migrated(noEntities));
      expect(await olderFormatRows()).toEqual(["rr_legacy", "rr_legacy_site"]);
    });

    // The Builder's own registry upsert leaves a description or admin block
    // its manifest entry omits, so the writer does not clear one either.
    it("keeps a Builder entity's description its manifest entry does not say", async () => {
      const builderOnly = defineConfig({
        collections: [],
        db: { migrationsDir: "./migrations" },
      });
      await writeFile(
        join(dir, "ui-schema.json"),
        `${JSON.stringify(
          uiSchemaManifest.parse({
            collections: [
              { slug: "rr_notes", fields: [{ name: "title", type: "text" }] },
            ],
          }),
          null,
          2
        )}\n`
      );
      await migrateCreate(builderOnly, "create_notes");
      await migrated(builderOnly);
      const db = (
        instance!.adapter as unknown as DrizzleAdapter
      ).getDrizzle<Selecting>();
      const { tables } = loadedDialect(dialect);
      const { eq } = await import("drizzle-orm");
      await db
        .update(tables.dynamicCollections)
        .set({ description: "set in the admin" })
        .where(eq(tables.dynamicCollections.slug, "rr_notes"));

      await migrated(builderOnly);
      expect(
        (await collectionRow(instance!, dialect, "rr_notes"))?.description
      ).toBe("set in the admin");
    });

    it("restores a row edited by hand with no migration pending", async () => {
      await migrateCreate(posts("Posts"), "create_posts");
      await migrated(posts("Posts"));
      const db = (
        instance!.adapter as unknown as DrizzleAdapter
      ).getDrizzle<Selecting>();
      const { tables } = loadedDialect(dialect);
      const { eq } = await import("drizzle-orm");
      await db
        .update(tables.dynamicCollections)
        .set({ description: "edited by hand" })
        .where(eq(tables.dynamicCollections.slug, "rr_posts"));

      await migrated(posts("Posts"));
      expect(
        (await collectionRow(instance!, dialect, "rr_posts"))?.description
      ).toBe("Posts");
    });

    it("keeps a field the running configuration lacks", async () => {
      const withBody = posts("Posts", text({ name: "body" }));
      await migrateCreate(withBody, "create_posts");
      await migrated(withBody);

      await migrated(posts("Posts"));
      expect(
        fieldNames(await collectionRow(instance!, dialect, "rr_posts"))
      ).toEqual(expect.arrayContaining(["title", "body"]));
    });

    it("leaves the row of an entity the newest snapshot no longer records, with no migration dropping it", async () => {
      const both = defineConfig({
        collections: [
          defineCollection({
            slug: "rr_posts",
            description: "Posts",
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: "rr_tags",
            description: "Tags",
            fields: [text({ name: "label" })],
          }),
        ],
        db: { migrationsDir: "./migrations" },
      });
      await migrateCreate(both, "create_both");
      await migrated(both);
      const tags = await collectionRow(instance!, dialect, "rr_tags");
      expect(tags).toBeDefined();

      // A later snapshot that records no `rr_tags`, beside a migration that
      // drops nothing.
      const later = await migrateCreate(
        defineConfig({
          ...both,
          collections: [
            defineCollection({
              slug: "rr_posts",
              description: "All posts",
              fields: [text({ name: "title" })],
            }),
            defineCollection({
              slug: "rr_tags",
              description: "Tags",
              fields: [text({ name: "label" })],
            }),
          ],
        }),
        "describe_posts"
      );
      const snapshotPath = join(
        dir,
        "migrations",
        "meta",
        later.replace(/\.sql$/, ".snapshot.json")
      );
      const snapshot = JSON.parse(await readFile(snapshotPath, "utf-8"));
      delete snapshot.entities.collections.rr_tags;
      await writeFile(snapshotPath, JSON.stringify(snapshot));

      await migrated(both);
      expect(await collectionRow(instance!, dialect, "rr_tags")).toEqual(tags);
      expect(
        (await collectionRow(instance!, dialect, "rr_posts"))?.description
      ).toBe("All posts");
    });

    it("writes the rows of the migrations that applied when a later one fails", async () => {
      await migrateCreate(posts("Posts"), "create_posts");
      const withBody = posts("Posts", text({ name: "body" }));
      const second = await migrateCreate(withBody, "add_body");
      // The second file fails on its last statement, after the first applied.
      const path = join(dir, "migrations", second);
      const sql = await readFile(path, "utf-8");
      await writeFile(
        path,
        sql.replace(
          /(-- DOWN)/,
          `--> statement-breakpoint\nSELECT * FROM ${q}rr_no_such_table${q};\n\n$1`
        )
      );

      const run = await migrate(withBody);
      expect(run.code, run.said.join("\n")).not.toBeUndefined();
      const row = await collectionRow(instance!, dialect, "rr_posts");
      expect(fieldNames(row)).toContain("title");
      expect(fieldNames(row)).not.toContain("body");
    });

    it("keeps a type an applied migration changed on a run that applies nothing", async () => {
      const asText = defineConfig({
        collections: [
          defineCollection({
            slug: "rr_scores",
            fields: [text({ name: "points" })],
          }),
        ],
        db: { migrationsDir: "./migrations" },
      });
      const asNumber = defineConfig({
        collections: [
          defineCollection({
            slug: "rr_scores",
            fields: [number({ name: "points" })],
          }),
        ],
        db: { migrationsDir: "./migrations" },
      });
      await migrateCreate(asText, "create_scores");
      await migrated(asText);
      await migrateCreate(asNumber, "points_number", undefined, {
        acceptDataLoss: true,
      });
      // A type change is a conversion the operator consents to.
      await migrated(asNumber, { acceptDataLoss: true });
      expect(
        fieldType(
          await collectionRow(instance!, dialect, "rr_scores"),
          "points"
        )
      ).toBe("number");

      // Nothing pending, and a configuration that still says text.
      await migrated(asText);
      expect(
        fieldType(
          await collectionRow(instance!, dialect, "rr_scores"),
          "points"
        )
      ).toBe("number");
    });

    // A row to restore exists before the second run starts, so a run that
    // wrote it outside the lock, before waiting, would show here.
    it("writes the rows only under the schema lock", async () => {
      await migrateCreate(posts("Posts"), "create_posts");
      await migrated(posts("Posts"));
      const db = (
        instance!.adapter as unknown as DrizzleAdapter
      ).getDrizzle<Selecting>();
      const { tables } = loadedDialect(dialect);
      const { eq } = await import("drizzle-orm");
      await db
        .update(tables.dynamicCollections)
        .set({ description: "edited by hand" })
        .where(eq(tables.dynamicCollections.slug, "rr_posts"));
      const adapter = instance!.adapter as unknown as DrizzleAdapter;
      // The lock is held from an async context of its own: a run started
      // inside the holder's body would hold it too, as the same holder.
      let acquired!: () => void;
      let release!: () => void;
      const held = new Promise<void>(resolve => (acquired = resolve));
      const released = new Promise<void>(resolve => (release = resolve));
      const holding = withMigrateLock(
        adapter,
        dialect,
        async () => {
          acquired();
          await released;
        },
        { mode: "fail-fast", command: "test holding the lock" }
      );
      await held;

      const runWhileHeld = migrate(posts("Posts"));
      // Long enough for a run that ignored the lock to have written.
      await new Promise(resolve => setTimeout(resolve, 1500));
      expect(
        (await collectionRow(instance!, dialect, "rr_posts"))?.description
      ).toBe("edited by hand");
      release();
      await holding;
      const run = await runWhileHeld;
      expect(run.code, run.said.join("\n")).toBeUndefined();
      expect(
        (await collectionRow(instance!, dialect, "rr_posts"))?.description
      ).toBe("Posts");
    });

    // A field's help text, placeholder and hidden switch change no column, so
    // the schema hash leaves them out; the row must still follow them.
    it("writes the field settings a settings-only migration changes, for each kind", async () => {
      const declared = (admin: Record<string, unknown>) =>
        defineConfig({
          collections: [
            defineCollection({
              slug: "rr_fs_posts",
              fields: [text({ name: "title", admin })],
            }),
          ],
          singles: [
            defineSingle({
              slug: "rr_fs_site",
              fields: [text({ name: "title", admin })],
            }),
          ],
          fieldGroups: [
            defineFieldGroup({
              slug: "rr_fs_hero",
              fields: [text({ name: "title", admin })],
            }),
          ],
          db: { migrationsDir: "./migrations" },
        });
      const before = declared({ description: "Old help", placeholder: "Old" });
      await migrateCreate(before, "create_fs");
      await migrated(before);

      const after = declared({
        description: "New help",
        placeholder: "New",
        hidden: true,
      });
      await migrateCreate(after, "field_settings");
      await migrated(after);
      for (const [kind, slug] of [
        ["collections", "rr_fs_posts"],
        ["singles", "rr_fs_site"],
        ["fieldGroups", "rr_fs_hero"],
      ] as const) {
        expect(
          fieldAdmin(await rowOf(instance!, dialect, kind, slug), "title"),
          `${kind} ${slug}`
        ).toMatchObject({
          description: "New help",
          placeholder: "New",
          hidden: true,
        });
      }
    });

    it("clears a description a migration cleared, declared in code or in the Builder", async () => {
      const declared = (description?: string) =>
        defineConfig({
          collections: [
            defineCollection({
              slug: "rr_cl_posts",
              ...(description === undefined ? {} : { description }),
              fields: [text({ name: "title" })],
            }),
          ],
          db: { migrationsDir: "./migrations" },
        });
      const created = uiSchemaManifest.parse({
        collections: [
          {
            slug: "rr_cl_events",
            description: "Things that happen",
            fields: [{ name: "title", type: "text" }],
          },
        ],
      });
      await writeManifest(created);
      await migrateCreate(declared("Posts"), "create_cl");
      await migrated(declared("Posts"));
      expect(
        (await collectionRow(instance!, dialect, "rr_cl_events"))?.description
      ).toBe("Things that happen");

      // Both descriptions removed: in code, and by the Builder's own upsert of
      // the entity without one.
      await writeManifest(
        mutateManifest(created, {
          type: "upsert",
          kind: "collections",
          entity: {
            slug: "rr_cl_events",
            fields: [{ name: "title", type: "text" }],
          },
        })
      );
      await migrateCreate(declared(), "clear_descriptions");
      await migrated(declared());
      for (const slug of ["rr_cl_posts", "rr_cl_events"]) {
        expect(
          (await collectionRow(instance!, dialect, slug))?.description ?? null,
          slug
        ).toBeNull();
      }
    });

    describe("a migration that drops a collection", () => {
      const both = defineConfig({
        collections: [
          defineCollection({
            slug: "rr_posts",
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: "rr_tags",
            fields: [text({ name: "label" })],
          }),
        ],
        db: { migrationsDir: "./migrations" },
      });
      const postsOnly = defineConfig({
        collections: [
          defineCollection({
            slug: "rr_posts",
            fields: [text({ name: "title" })],
          }),
        ],
        db: { migrationsDir: "./migrations" },
      });

      it("removes its row once applied with consent, and keeps every other", async () => {
        await migrateCreate(both, "create_both");
        await migrated(both);
        const kept = await collectionRow(instance!, dialect, "rr_posts");
        expect(
          await collectionRow(instance!, dialect, "rr_tags")
        ).toBeDefined();

        await migrateCreate(postsOnly, "drop_tags", undefined, {
          acceptDataLoss: true,
        });
        await migrated(postsOnly, { acceptDataLoss: true });
        expect(
          await collectionRow(instance!, dialect, "rr_tags")
        ).toBeUndefined();
        expect(await collectionRow(instance!, dialect, "rr_posts")).toEqual(
          kept
        );
      });

      // A run that applied the drop and stopped before its rows, or an
      // earlier release that applied it, left the row: the next run removes it.
      it("removes the row a run that applied the drop left behind", async () => {
        await migrateCreate(both, "create_both");
        await migrated(both);
        const tags = await collectionRow(instance!, dialect, "rr_tags");
        await migrateCreate(postsOnly, "drop_tags", undefined, {
          acceptDataLoss: true,
        });
        await migrated(postsOnly, { acceptDataLoss: true });

        const db = (instance!.adapter as unknown as DrizzleAdapter).getDrizzle<{
          insert: (table: unknown) => {
            values: (row: Row) => Promise<unknown>;
          };
        }>();
        const { tables } = loadedDialect(dialect);
        await db.insert(tables.dynamicCollections).values(tags!);
        expect(
          await collectionRow(instance!, dialect, "rr_tags")
        ).toBeDefined();

        await migrated(postsOnly);
        expect(
          await collectionRow(instance!, dialect, "rr_tags")
        ).toBeUndefined();
      });

      // A registry that cannot be read cannot say whether the row is there:
      // the run names it as not done rather than reading as complete.
      it("names the row it could not remove when the registry cannot be read", async () => {
        await migrateCreate(both, "create_both");
        await migrated(both);
        await migrateCreate(postsOnly, "drop_tags", undefined, {
          acceptDataLoss: true,
        });
        const { CollectionRegistryService } = await import(
          "../../../domains/collections/services/collection-registry-service"
        );
        const read = vi
          .spyOn(CollectionRegistryService.prototype, "getAllCollections")
          .mockRejectedValue(new Error("unreadable row"));
        let said: string[];
        try {
          ({ said } = await migrate(postsOnly, { acceptDataLoss: true }));
        } finally {
          read.mockRestore();
        }
        expect(said.join("\n")).toMatch(
          /not brought to[^\n]*collection rr_tags/
        );
        expect(
          await collectionRow(instance!, dialect, "rr_tags")
        ).toBeDefined();
      });
    });

    describe("a migration that changes a field's type", () => {
      const scores = (points: "text" | "number", ...extra: string[]) =>
        defineConfig({
          collections: [
            defineCollection({
              slug: "rr_scores",
              fields: [
                points === "text"
                  ? text({ name: "points" })
                  : number({ name: "points" }),
                ...extra.map(name => text({ name })),
              ],
            }),
          ],
          db: { migrationsDir: "./migrations" },
        });

      /** A table the probe statement copies the row's field list into. */
      async function createProbe(): Promise<void> {
        await (instance!.adapter as unknown as DrizzleAdapter).executeQuery(
          `CREATE TABLE ${q}rr_probe${q} (${q}fields${q} TEXT)`
        );
      }

      /** The statement copying `rr_scores`'s recorded field list into the probe. */
      const probe = () =>
        `INSERT INTO ${q}rr_probe${q} (${q}fields${q}) SELECT CAST(${q}fields${q} AS ${
          dialect === "mysql" ? "CHAR" : "TEXT"
        }) FROM ${q}dynamic_collections${q} WHERE ${q}slug${q} = 'rr_scores'`;

      /** The type of `points` in the field list the probe copied. */
      async function probedType(): Promise<unknown> {
        const rows = await (
          instance!.adapter as unknown as DrizzleAdapter
        ).executeQuery<{ fields: string }>(
          `SELECT ${q}fields${q} FROM ${q}rr_probe${q}`
        );
        expect(rows).toHaveLength(1);
        return fieldType({ fields: rows[0].fields }, "points");
      }

      // The probe runs in the file after the type change, in the same run: a
      // row written only at the run's end still says text there.
      it("records the entity's row with its file, before the run's next file", async () => {
        await migrateCreate(scores("text"), "create_scores");
        await migrated(scores("text"));
        await createProbe();
        await migrateCreate(scores("number"), "points_number", undefined, {
          acceptDataLoss: true,
        });
        const next = await migrateCreate(scores("number", "note"), "add_note");
        await insertStatement(next, "up-last", probe());

        await migrated(scores("number", "note"), { acceptDataLoss: true });
        expect(await probedType()).toBe("number");
      });

      // In a transaction the conversion and its row commit together: a ledger
      // write that fails after both leaves neither. MySQL commits its DDL as
      // it runs, so there is no transaction to undo the column with.
      it.skipIf(dialect === "mysql")(
        "rolls back the column and its row together when the file cannot be recorded",
        async () => {
          await migrateCreate(scores("text"), "create_scores");
          await migrated(scores("text"));
          await migrateCreate(scores("number"), "points_number", undefined, {
            acceptDataLoss: true,
          });
          const { SchemaEventsRepository } = await import(
            "../../../domains/schema/events/schema-events-repository"
          );
          const record = vi
            .spyOn(SchemaEventsRepository.prototype, "markApplied")
            .mockRejectedValue(new Error("ledger write refused"));
          let run: { code: number | undefined; said: string[] };
          let recorded: number;
          try {
            run = await migrate(scores("number"), { acceptDataLoss: true });
          } finally {
            recorded = record.mock.calls.length;
            record.mockRestore();
          }
          expect(run.code, run.said.join("\n")).not.toBeUndefined();
          // Stopped by the refused record, after the conversion and its row.
          expect(recorded).toBeGreaterThan(0);
          expect(
            fieldType(
              await collectionRow(instance!, dialect, "rr_scores"),
              "points"
            )
          ).toBe("text");
          const adapter = instance!.adapter as unknown as DrizzleAdapter;
          const columns =
            dialect === "sqlite"
              ? (
                  await adapter.executeQuery<{ name: string; type: string }>(
                    `PRAGMA table_info("dc_rr_scores")`
                  )
                ).map(c => ({ name: c.name, type: c.type }))
              : (
                  await adapter.executeQuery<{
                    column_name: string;
                    data_type: string;
                  }>(
                    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'dc_rr_scores'`
                  )
                ).map(c => ({ name: c.column_name, type: c.data_type }));
          expect(
            columns.find(c => c.name === "points")?.type.toLowerCase()
          ).toMatch(/text|char/);
        }
      );

      it("records it with its DOWN when migrate:down rolls it back, before the next DOWN", async () => {
        await migrateCreate(scores("text"), "create_scores");
        await migrated(scores("text"));
        const note = await migrateCreate(scores("text", "note"), "add_note");
        await insertStatement(note, "down-first", probe());
        await migrateCreate(
          scores("number", "note"),
          "points_number",
          undefined,
          { acceptDataLoss: true }
        );
        await migrated(scores("number", "note"), { acceptDataLoss: true });
        await createProbe();

        await migratedDown(scores("number", "note"), 2);
        expect(await probedType()).toBe("text");
        expect(
          fieldType(
            await collectionRow(instance!, dialect, "rr_scores"),
            "points"
          )
        ).toBe("text");
      });
    });

    describe("migrate:down undoes the rolled-back migrations' own registry changes", () => {
      it("puts back a description a settings-only migration changed", async () => {
        await migrateCreate(posts("Posts"), "create_posts");
        await migrated(posts("Posts"));
        await migrateCreate(posts("All posts"), "describe_posts");
        await migrated(posts("All posts"));
        expect(
          (await collectionRow(instance!, dialect, "rr_posts"))?.description
        ).toBe("All posts");

        await migratedDown(posts("All posts"));
        expect(
          (await collectionRow(instance!, dialect, "rr_posts"))?.description
        ).toBe("Posts");
      });

      it("removes the row of a collection a rolled-back migration added, and nothing else", async () => {
        const withTags = defineConfig({
          collections: [
            defineCollection({
              slug: "rr_posts",
              description: "Posts",
              fields: [text({ name: "title" })],
            }),
            defineCollection({
              slug: "rr_tags",
              fields: [text({ name: "label" })],
            }),
          ],
          db: { migrationsDir: "./migrations" },
        });
        await migrateCreate(posts("Posts"), "create_posts");
        await migrated(posts("Posts"));
        await migrateCreate(withTags, "create_tags");
        await migrated(withTags);
        // A row no snapshot records, which no rollback may touch.
        const tags = await collectionRow(instance!, dialect, "rr_tags");
        const db = (instance!.adapter as unknown as DrizzleAdapter).getDrizzle<{
          insert: (table: unknown) => {
            values: (row: Row) => Promise<unknown>;
          };
        }>();
        const { tables } = loadedDialect(dialect);
        await db.insert(tables.dynamicCollections).values({
          ...tags!,
          id: `${String(tags!.id)}-own`,
          slug: "rr_own",
          tableName: "dc_rr_own",
        });
        const own = await collectionRow(instance!, dialect, "rr_own");
        const posted = await collectionRow(instance!, dialect, "rr_posts");

        await migratedDown(withTags);
        expect(
          await collectionRow(instance!, dialect, "rr_tags")
        ).toBeUndefined();
        expect(await collectionRow(instance!, dialect, "rr_posts")).toEqual(
          posted
        );
        expect(await collectionRow(instance!, dialect, "rr_own")).toEqual(own);
      });

      // A recorded row the rolled-back migration never touched keeps what it
      // holds, even where it differs from the snapshot the rollback reaches.
      it("leaves a recorded row the rolled-back migration did not change", async () => {
        const both = (posts: string) =>
          defineConfig({
            collections: [
              defineCollection({
                slug: "rr_posts",
                description: posts,
                fields: [text({ name: "title" })],
              }),
              defineCollection({
                slug: "rr_tags",
                description: "Tags",
                fields: [text({ name: "label" })],
              }),
            ],
            db: { migrationsDir: "./migrations" },
          });
        await migrateCreate(both("Posts"), "create_both");
        await migrated(both("Posts"));
        await migrateCreate(both("All posts"), "describe_posts");
        await migrated(both("All posts"));
        const db = (
          instance!.adapter as unknown as DrizzleAdapter
        ).getDrizzle<Selecting>();
        const { tables } = loadedDialect(dialect);
        const { eq } = await import("drizzle-orm");
        await db
          .update(tables.dynamicCollections)
          .set({ description: "kept by another writer" })
          .where(eq(tables.dynamicCollections.slug, "rr_tags"));

        await migratedDown(both("All posts"));
        expect(
          (await collectionRow(instance!, dialect, "rr_posts"))?.description
        ).toBe("Posts");
        expect(
          (await collectionRow(instance!, dialect, "rr_tags"))?.description
        ).toBe("kept by another writer");
      });

      // The rows go back with the last DOWN, in its transaction: a row that
      // cannot be written leaves the migration applied and its row as it was.
      it("rolls nothing back when a row cannot be written back", async () => {
        await migrateCreate(posts("Posts"), "create_posts");
        await migrated(posts("Posts"));
        const describe = await migrateCreate(posts("All posts"), "describe");
        await migrated(posts("All posts"));
        const { CollectionRegistryService } = await import(
          "../../../domains/collections/services/collection-registry-service"
        );
        const write = vi
          .spyOn(CollectionRegistryService.prototype, "writeRecordedCollection")
          .mockRejectedValue(new Error("registry row refused"));
        try {
          loaded.config = posts("All posts");
          tick();
          const { context } = command();
          setNonInteractive(true);
          // The command itself throws; its action turns that into an exit.
          await expect(
            asItsOwnProcess(() =>
              runMigrateDown({ cwd: dir, acceptDataLoss: true }, context)
            ).finally(() => setNonInteractive(false))
          ).rejects.toThrow(/registry row refused/);
        } finally {
          write.mockRestore();
        }
        expect(
          (await collectionRow(instance!, dialect, "rr_posts"))?.description
        ).toBe("All posts");
        const { SchemaEventsRepository } = await import(
          "../../../domains/schema/events/schema-events-repository"
        );
        expect(
          await new SchemaEventsRepository(
            (instance!.adapter as unknown as DrizzleAdapter).getDrizzle(),
            dialect
          ).isFileApplied(describe)
        ).toBe(true);
      });
    });

    // One point, two paths to it: `nextly migrate` stopping there, and
    // `migrate:down` coming back to it from a later migration.
    it("migrate:down to a point leaves the rows nextly migrate leaves there", async () => {
      const first = posts("Posts");
      await migrateCreate(first, "create_posts");
      await migrated(first);
      const atPoint = await registryRows(instance!, dialect);

      const later = defineConfig({
        collections: [
          defineCollection({
            slug: "rr_posts",
            description: "All posts",
            fields: [
              text({ name: "title", admin: { placeholder: "Title" } }),
              text({ name: "body" }),
            ],
          }),
          defineCollection({
            slug: "rr_tags",
            fields: [text({ name: "label" })],
          }),
        ],
        db: { migrationsDir: "./migrations" },
      });
      await migrateCreate(later, "later");
      await migrated(later);
      await migratedDown(later);

      const back = await registryRows(instance!, dialect);
      expect(declaredColumns(back.collections, "rr_posts")).toEqual(
        declaredColumns(atPoint.collections, "rr_posts")
      );
      expect(declaredColumns(back.collections, "rr_tags")).toBeUndefined();
    });

    describe("an earlier release's snapshots, which record no settings", () => {
      /** Make `file`'s snapshot one an earlier release wrote: no registry metadata, no permissions. */
      async function asEarlierRelease(file: string): Promise<void> {
        const path = join(
          dir,
          "migrations",
          "meta",
          file.replace(/\.sql$/, ".snapshot.json")
        );
        const snapshot = JSON.parse(await readFile(path, "utf-8"));
        delete snapshot.entities;
        delete snapshot.permissions;
        await writeFile(path, JSON.stringify(snapshot, null, 2));
      }

      const undescribed = (...extra: ReturnType<typeof text>[]) =>
        defineConfig({
          collections: [
            defineCollection({
              slug: "rr_posts",
              fields: [text({ name: "title" }), ...extra],
            }),
          ],
          db: { migrationsDir: "./migrations" },
        });

      it("nextly migrate clears no setting because of what they lack", async () => {
        await asEarlierRelease(await migrateCreate(posts("Posts"), "create"));
        const withBody = posts("Posts", text({ name: "body" }));
        await asEarlierRelease(await migrateCreate(withBody, "add_body"));
        // The first run on this release writes the rows from the configuration
        // and takes the registry record.
        await migrated(withBody);
        expect(
          (await collectionRow(instance!, dialect, "rr_posts"))?.description
        ).toBe("Posts");

        // A configuration without the description: nothing of it is read here,
        // and the newest applied snapshot says nothing of the description.
        await migrated(undescribed(text({ name: "body" })));
        expect(
          (await collectionRow(instance!, dialect, "rr_posts"))?.description
        ).toBe("Posts");
      });

      it("migrate:down between two of them, before the registry record exists, leaves the rows as they are", async () => {
        await asEarlierRelease(await migrateCreate(posts("Posts"), "create"));
        const withBody = posts("Posts", text({ name: "body" }));
        await asEarlierRelease(await migrateCreate(withBody, "add_body"));
        await migrated(withBody);
        // As an earlier release left the database: no record.
        await (instance!.adapter as unknown as DrizzleAdapter).executeQuery(
          `DELETE FROM ${q}nextly_meta${q} WHERE ${q}key${q} = 'registry_record'`
        );
        const before = await registryRows(instance!, dialect);

        await migratedDown(withBody);
        expect(await registryRows(instance!, dialect)).toEqual(before);
      });
    });
  }
);
