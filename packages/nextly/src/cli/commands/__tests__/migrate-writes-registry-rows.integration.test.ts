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
import { loadedDialect } from "../../../database/dialect-tables";
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

/** `nextly migrate:create --name=<name> --non-interactive` over `config`. */
async function migrateCreate(config: unknown, name: string): Promise<string> {
  loaded.config = config;
  tick();
  const { context, said } = command();
  setNonInteractive(true);
  const code = await exiting(() =>
    runMigrateCreate(name, { cwd: dir }, context)
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

/** `nextly migrate:down --step <step>`, consenting to what it deletes, which must succeed. */
async function migratedDown(config: unknown, step = 1): Promise<void> {
  loaded.config = config;
  tick();
  const { context, said } = command();
  setNonInteractive(true);
  const code = await exiting(() =>
    runMigrateDown({ cwd: dir, step, acceptDataLoss: true }, context)
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

type Row = Record<string, unknown>;
interface Selecting {
  select: () => { from: (table: unknown) => Promise<Row[]> };
  update: (table: unknown) => {
    set: (values: Row) => { where: (condition: unknown) => Promise<unknown> };
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
      await migrateCreate(asNumber, "points_number");
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

        await migrateCreate(postsOnly, "drop_tags");
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
        await migrateCreate(postsOnly, "drop_tags");
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
        await migrateCreate(scores("number"), "points_number");
        const next = await migrateCreate(scores("number", "note"), "add_note");
        await insertStatement(next, "up-last", probe());

        await migrated(scores("number", "note"), { acceptDataLoss: true });
        expect(await probedType()).toBe("number");
      });

      it("records it with its DOWN when migrate:down rolls it back, before the next DOWN", async () => {
        await migrateCreate(scores("text"), "create_scores");
        await migrated(scores("text"));
        const note = await migrateCreate(scores("text", "note"), "add_note");
        await insertStatement(note, "down-first", probe());
        await migrateCreate(scores("number", "note"), "points_number");
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
