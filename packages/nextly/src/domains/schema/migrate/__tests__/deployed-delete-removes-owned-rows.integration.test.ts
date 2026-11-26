/**
 * `nextly migrate` removes in a deployed database what deleting a collection in the Schema
 * Builder removes in development: its tables, from the migration file, and, once the file is
 * recorded applied, the rows other tables hold for it: its registry row with its autosaves, version
 * pins and "seen" markers, in the registry write, then, once that has committed, its field-group
 * values, archived translations, translation provenance and suggested translations. Another
 * collection's rows in the same shared tables stay.
 *
 * A run stopped part-way leaves what the dialect can promise. Inside the file, PostgreSQL and
 * SQLite roll the file back, so nothing is removed and the next run applies it whole; MySQL keeps
 * the drops that ran and refuses the next run until `migrate:resolve` records the file. After the
 * file is recorded applied, the next run removes what remains, with nothing pending, running no
 * drop again and recording nothing new in the ledger.
 *
 * Two databases, each reached through `DATABASE_URL` as an app's would: the Builder's, where the
 * collections are created and one deleted in development, each save writing its migration, and the
 * deployed one, where `nextly migrate` applies those migrations.
 */
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../../__tests__/helpers/fresh-database";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../../../cli/__tests__/helpers/run-nextly";
import { runMigrate } from "../../../../cli/commands/migrate";
import { runMigrateResolve } from "../../../../cli/commands/migrate-resolve";
import type { CommandContext } from "../../../../cli/program";
import type { AcceptDataLossOption } from "../../../../cli/utils/data-loss-consent";
import { createLogger } from "../../../../cli/utils/logger";
import { defineConfig, fieldGroup, text } from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { clearServices, shutdownServices } from "../../../../di/register";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { _resetEnvCache } from "../../../../shared/lib/env";
import { clearRegistryRowCache } from "../../../dynamic-collections/services/collection-row-cache";
import { ensureI18nArchive } from "../../../i18n/migration/ensure-archive";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { resolveComponentTableName } from "../../utils/resolve-table-name";
import { setNonInteractive } from "../can-prompt";
import { KILL_AT_VARIABLE, withStopPoints } from "../stop-points";

/** The configuration the commands load. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const MIGRATIONS = "./migrations";
const DEFINITION = "./schema/builder.json";
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };
const PROJECT = defineConfig({
  collections: [],
  localization: LOCALIZATION,
  db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION },
});

/** The field group both collections use, the collection deleted, the one kept, and a tag list. */
const META = "dpr_meta";
const NOTES = "dpr_notes";
const OTHER = "dpr_other";
const TAGS = "dpr_tags";
const NOTES_TABLE = `dc_${NOTES}`;
const OTHER_TABLE = `dc_${OTHER}`;
const META_TABLE = resolveComponentTableName(META);

/**
 * The points a run reaches once the delete file is recorded, in order, as a stop names them after
 * the file's or the collection's name (`stop-points.ts`), and whether `dpr_notes`'s registry row
 * still stands when a process is killed there: the registry write removes it, then what the
 * collection left goes, in a transaction of its own.
 */
const AFTER_THE_FILE = [
  { at: "recorded applied", registryRow: 1 },
  { at: "removed registryRow", registryRow: 1 },
  { at: "registry written", registryRow: 0 },
  { at: "removed fieldGroupValues", registryRow: 0 },
  { at: "removed translationRows", registryRow: 0 },
  { at: "removed leftovers", registryRow: 0 },
] as const;

/** Whether `point` is the one named `at`, after the file's or the collection's name, or alone. */
const isPoint = (point: string, at: string) =>
  point === at || point.endsWith(`: ${at}`);

let dir: string;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-deployed-retire-"));
  mkdirSync(join(dir, "migrations"));
  // As a deploy runs it: a consent that does not cover a deletion is refused at once, never asked.
  setNonInteractive(true);
});

afterEach(async () => {
  setNonInteractive(false);
  await shutdownServices().catch(() => {});
  for (const close of closers.splice(0)) await close();
  vi.unstubAllEnvs();
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/** A database of this test's own, by name, and the URL the commands reach it by. */
async function openDatabase(
  dialect: TestDialect,
  name: string
): Promise<{ adapter: DrizzleAdapter; url: string }> {
  let url: string;
  if (dialect === "sqlite") {
    url = `file:${join(dir, `${name}.db`)}`;
  } else {
    const scratch = await createScratchDatabase(dialect, `nextly_dr_${name}`);
    url = scratch.url;
    closers.push(() => scratch.drop());
  }
  const adapter = (await createAdapter({
    type: dialect,
    url,
  } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
  closers.unshift(() => adapter.disconnect().catch(() => {}));
  return { adapter, url };
}

/** Point the commands and the env at `url`. */
function reach(dialect: TestDialect, url: string): void {
  vi.stubEnv("DB_DIALECT", dialect);
  vi.stubEnv("DATABASE_URL", url);
  _resetEnvCache();
}

/** Start the app over `adapter`, with the project's migrations and definition below `dir`. */
async function start(adapter: DrizzleAdapter): Promise<TestNextly> {
  // Cleared, not shut down: shutting the services down would disconnect the adapter they hold.
  clearServices();
  clearRegistryRowCache();
  return createTestNextly({
    adapter: adapter as never,
    basePath: dir,
    db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION },
    localization: LOCALIZATION,
  });
}

/** A command over the project, as the CLI runs it: its exit code (undefined when it finished) and what it said. */
async function command(
  run: (context: CommandContext) => Promise<void>
): Promise<{ code: number | undefined; said: string }> {
  const said: string[] = [];
  const capture = (message: string) => {
    said.push(message);
  };
  const context = {
    logger: {
      ...createLogger({ quiet: true }),
      info: capture,
      warn: capture,
      success: capture,
      error: capture,
    },
    options: {},
    cwd: dir,
  } as CommandContext;
  const printed = vi.spyOn(console, "error").mockImplementation(message => {
    said.push(String(message));
  });
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await run(context);
    return { code: undefined, said: said.join("\n") };
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return { code: Number(match[1]), said: said.join("\n") };
    throw error;
  } finally {
    exit.mockRestore();
    printed.mockRestore();
  }
}

/** `nextly migrate` over the project, with `consent` to losing data. */
function migrate(consent: AcceptDataLossOption = NOTES_TABLE) {
  loaded.config = PROJECT;
  return command(context =>
    runMigrate(
      { cwd: dir, acceptDataLoss: consent } as Parameters<typeof runMigrate>[0],
      context
    )
  );
}

/** The Builder's own saves, in development, as its dialogs send them. */
async function builder<T>(work: () => Promise<T>): Promise<T> {
  vi.stubEnv("NODE_ENV", "development");
  try {
    return await work();
  } finally {
    vi.stubEnv("NODE_ENV", "test");
  }
}

const manyToMany = (name: string, target: string) => ({
  name,
  type: "relationship",
  options: { relationType: "manyToMany", target },
});

/** In the Builder: the field group, the tag list, and the two collections that use the field group. */
async function createInTheBuilder(): Promise<void> {
  await dispatchComponents(
    "createComponent",
    {},
    { slug: META, label: META, fields: [text({ name: "note" })] }
  );
  await dispatchCollections(
    {} as ServiceContainer,
    "createCollection",
    {},
    { name: TAGS, label: TAGS, fields: [text({ name: "title" })] }
  );
  await dispatchCollections(
    {} as ServiceContainer,
    "createCollection",
    {},
    {
      name: NOTES,
      label: NOTES,
      localized: true,
      fields: [
        text({ name: "body", localized: true }),
        fieldGroup({ name: "meta", component: META }),
        manyToMany("tags", TAGS),
      ],
    }
  );
  await dispatchCollections(
    {} as ServiceContainer,
    "createCollection",
    {},
    {
      name: OTHER,
      label: OTHER,
      localized: true,
      fields: [
        text({ name: "body", localized: true }),
        fieldGroup({ name: "meta", component: META }),
      ],
    }
  );
}

/** On the deployed site: an entry in each collection, with field-group values, and a translation of the note. */
async function writeEntries(site: TestNextly): Promise<void> {
  const note = await site.nextly.create({
    collection: NOTES as never,
    data: { body: "Hello", meta: { note: "n" } } as never,
  });
  await site.nextly.update({
    collection: NOTES as never,
    id: (note.item as { id: string }).id as never,
    locale: "es",
    data: { body: "Hola", _overwrite: true } as never,
  });
  await site.nextly.create({
    collection: OTHER as never,
    data: { meta: { note: "o" } } as never,
  });
}

/** The rows a collection's documents keep outside its tables: one of each kind, for `slug`. */
async function seedSharedRows(
  adapter: DrizzleAdapter,
  slug: string
): Promise<void> {
  const now = new Date();
  await adapter.insert("nextly_versions", {
    id: randomUUID(),
    scopeKind: "collection",
    scopeSlug: slug,
    entryId: "e1",
    versionNo: null,
    status: "draft",
    isAutosave: true,
    snapshot: JSON.stringify({}),
    createdAt: now,
    updatedAt: now,
  });
  await adapter.insert("nextly_version_pins", {
    id: randomUUID(),
    scopeKind: "collection",
    scopeSlug: slug,
    entryId: "e1",
    holder: "release",
    slot: "s",
    versionNo: 1,
    pinKey: `collection:${slug}:e1`,
    createdAt: now,
    updatedAt: now,
  });
  await adapter.insert("nextly_version_views", {
    id: randomUUID(),
    userId: "u1",
    scopeKind: "collection",
    scopeSlug: slug,
    entryId: "e1",
    part: "",
    viewKey: `collection:${slug}:e1:u1`,
    versionNo: 1,
    viewedAt: now,
    visitStartedAt: now,
    createdAt: now,
  });
  await ensureI18nArchive(adapter, adapter.getCapabilities().dialect);
  await adapter.insert("nextly_i18n_archive", {
    collection: slug,
    entityKind: "collection",
    entryId: "e1",
    locale: "fr",
    field: "title",
    value: "b",
    archivedAt: now,
  });
  await adapter.insert("nextly_translation_provenance", {
    id: randomUUID(),
    scopeKind: "collection",
    scopeSlug: slug,
    entryId: "e1",
    locale: "fr",
    partState: "live",
    fieldPath: "title",
    valueFingerprint: "f",
    origin: "machine",
    writtenAt: now,
  });
  await adapter.insert("nextly_translation_sources", {
    id: randomUUID(),
    scopeKind: "collection",
    scopeSlug: slug,
    entryId: "e1",
    sourceLocale: "en",
    // A translated field of both collections: text kept for a field a collection does not
    // translate goes with any migrate run, whatever was deleted.
    fieldPath: "body",
    fingerprint: "f",
    content: { value: "a" },
    recordedAt: now,
  });
  await adapter.insert("nextly_translation_suggestions", {
    id: randomUUID(),
    scopeKind: "collection",
    scopeSlug: slug,
    entryId: "e1",
    targetLocale: "fr",
    sourceLocale: "en",
    fieldPath: "title",
    unitKey: "k",
    unitAddress: [{ field: "title" }],
    value: { value: "b" },
    origin: "machine",
    sourceFingerprint: "f",
    createdAt: now,
  });
}

/** How many rows of each kind `slug` (whose table is `table`) holds on `adapter`. */
async function rowsOf(
  adapter: DrizzleAdapter,
  dialect: TestDialect,
  slug: string,
  table: string
): Promise<Record<string, number>> {
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const count = async (from: string, where: string, params: unknown[]) =>
    Number(
      (
        await adapter.executeQuery<{ n: unknown }>(
          `SELECT COUNT(*) AS n FROM ${q(from)} WHERE ${where}`,
          params as never
        )
      )[0]?.n ?? Number.NaN
    );
  const p = (n: number) => (dialect === "postgresql" ? `$${n}` : "?");
  const scoped = `${q("scope_kind")} = ${p(1)} AND ${q("scope_slug")} = ${p(2)}`;
  return {
    fieldGroupValues: await count(
      META_TABLE,
      `${q("_parent_table")} = ${p(1)}`,
      [table]
    ),
    registryRow: await count("dynamic_collections", `${q("slug")} = ${p(1)}`, [
      slug,
    ]),
    autosaves: await count("nextly_versions", scoped, ["collection", slug]),
    versionPins: await count("nextly_version_pins", scoped, [
      "collection",
      slug,
    ]),
    seenMarkers: await count("nextly_version_views", scoped, [
      "collection",
      slug,
    ]),
    translationArchive: await count(
      "nextly_i18n_archive",
      `${q("collection")} = ${p(1)} AND ${q("entity_kind")} = ${p(2)}`,
      [slug, "collection"]
    ),
    translationProvenance: await count(
      "nextly_translation_provenance",
      scoped,
      ["collection", slug]
    ),
    translationSources: await count("nextly_translation_sources", scoped, [
      "collection",
      slug,
    ]),
    translationSuggestions: await count(
      "nextly_translation_suggestions",
      scoped,
      ["collection", slug]
    ),
  };
}

/** Every kind `rowsOf` counts, at zero. */
const NONE = {
  fieldGroupValues: 0,
  registryRow: 0,
  autosaves: 0,
  versionPins: 0,
  seenMarkers: 0,
  translationArchive: 0,
  translationProvenance: 0,
  translationSources: 0,
  translationSuggestions: 0,
};

/** How many migrations the deployed database's ledger records applied. */
async function ledgerOf(
  adapter: DrizzleAdapter,
  dialect: TestDialect
): Promise<number> {
  return (
    await new SchemaEventsRepository(
      adapter.getDrizzle(),
      dialect
    ).listFileApplies()
  ).length;
}

/** The newest migration file: the delete's, once the Builder has written it. */
/**
 * Drops by hand the tables of `dpr_notes` a stopped MySQL run left, as an operator finishes the
 * file: its translations table and its many-to-many junction first, since each holds a key to the
 * collection's table, and the collection's table last.
 */
async function dropNotesTablesByHand(deployed: DrizzleAdapter): Promise<void> {
  const left = (await deployed.listTables()).filter(
    table => table === NOTES_TABLE || table.startsWith(`${NOTES_TABLE}_`)
  );
  const parentLast = [
    ...left.filter(table => table !== NOTES_TABLE),
    ...left.filter(table => table === NOTES_TABLE),
  ];
  for (const table of parentLast) {
    await deployed.executeQuery(`DROP TABLE IF EXISTS \`${table}\``);
  }
}

function deleteFile(): { name: string; drops: number } {
  const files = readdirSync(join(dir, "migrations"))
    .filter(name => name.endsWith(".sql"))
    .sort();
  const name = files.at(-1) ?? "";
  const sql = readFileSync(join(dir, "migrations", name), "utf8");
  return { name, drops: (sql.match(/DROP TABLE/gi) ?? []).length };
}

describe.each(getConfiguredTestDialects())(
  "a collection deleted in the Builder, on a deployed database (%s)",
  dialect => {
    /**
     * The Builder's create, applied to the deployed database with an entry in each collection and
     * the shared rows of both, then the Builder's delete of `dpr_notes`, written and not yet
     * applied: the deployed database to apply it to, and what both collections held there.
     */
    async function readyToDelete() {
      const own = await openDatabase(dialect, "builder");
      const deployed = await openDatabase(dialect, "deployed");

      reach(dialect, own.url);
      await start(own.adapter);
      await builder(createInTheBuilder);

      reach(dialect, deployed.url);
      await start(deployed.adapter);
      const created = await migrate(true);
      expect(created.code, created.said).toBeUndefined();
      await writeEntries(await start(deployed.adapter));
      await seedSharedRows(deployed.adapter, NOTES);
      await seedSharedRows(deployed.adapter, OTHER);
      const notes = await rowsOf(deployed.adapter, dialect, NOTES, NOTES_TABLE);
      const other = await rowsOf(deployed.adapter, dialect, OTHER, OTHER_TABLE);
      // Positive control: the deployed database holds rows of every kind for both; writing an
      // entry records provenance of its own beside the seeded row.
      for (const held of [notes, other]) {
        for (const [kind, rows] of Object.entries(held)) {
          expect(rows, kind).toBeGreaterThan(0);
        }
      }

      reach(dialect, own.url);
      await start(own.adapter);
      await builder(() =>
        dispatchCollections(
          {} as ServiceContainer,
          "deleteCollection",
          { collectionName: NOTES },
          undefined
        )
      );

      reach(dialect, deployed.url);
      await start(deployed.adapter);
      return { deployed: deployed.adapter, url: deployed.url, notes, other };
    }

    const notesLeft = (adapter: DrizzleAdapter) =>
      rowsOf(adapter, dialect, NOTES, NOTES_TABLE);
    const otherLeft = (adapter: DrizzleAdapter) =>
      rowsOf(adapter, dialect, OTHER, OTHER_TABLE);

    it("removes every row the collection owned with its tables, and none of another collection's", async () => {
      const { deployed, other } = await readyToDelete();
      const deleted = await migrate();

      expect(deleted.code, deleted.said).toBeUndefined();
      expect(await deployed.tableExists(NOTES_TABLE)).toBe(false);
      expect(await deployed.tableExists(`${NOTES_TABLE}_locales`)).toBe(false);
      expect(await notesLeft(deployed), deleted.said).toEqual(NONE);
      expect(await otherLeft(deployed)).toEqual(other);
    }, 240_000);

    it("removes nothing, and drops nothing, without the consent", async () => {
      const { deployed, notes, other } = await readyToDelete();
      const refused = await migrate(false);

      expect(refused.code, refused.said).not.toBeUndefined();
      expect(await deployed.tableExists(NOTES_TABLE)).toBe(true);
      expect(await notesLeft(deployed)).toEqual(notes);
      expect(await otherLeft(deployed)).toEqual(other);
    }, 240_000);

    it.each(AFTER_THE_FILE)(
      "finishes, with nothing pending, a run that failed once the file was recorded, at $at",
      async ({ at, registryRow }) => {
        const { deployed, other } = await readyToDelete();
        const stopped = await withStopPoints(
          point => {
            if (isPoint(point, at)) throw new Error(`stopped at ${at}`);
          },
          () => migrate()
        );
        // The run fails and the file stays recorded, its tables gone, and stops where it stands:
        // the registry row stays until the registry write commits.
        expect(stopped.code, stopped.said).not.toBeUndefined();
        expect(await deployed.tableExists(NOTES_TABLE)).toBe(false);
        expect((await notesLeft(deployed)).registryRow, stopped.said).toBe(
          registryRow
        );
        const ledger = await ledgerOf(deployed, dialect);

        const finished = await migrate();

        expect(finished.code, finished.said).toBeUndefined();
        expect(await notesLeft(deployed), finished.said).toEqual(NONE);
        expect(await otherLeft(deployed)).toEqual(other);
        // No drop ran again and the ledger recorded nothing new.
        expect(await ledgerOf(deployed, dialect)).toBe(ledger);
      },
      240_000
    );

    /**
     * `nextly migrate` as a real process over the deployed database, as a deploy runs it, killing
     * itself at `killAt` where one is named (`stop-points.ts`).
     */
    function migrateProcess(url: string, killAt?: string) {
      // The project's configuration as a deploy reads it: the commands in this process load it
      // through the mock above instead.
      writeFileSync(
        join(dir, "nextly.config.ts"),
        `export default ${JSON.stringify({
          collections: [],
          localization: LOCALIZATION,
          db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION },
        })};\n`
      );
      return runNextly(
        [
          "migrate",
          `--accept-data-loss=${NOTES_TABLE}`,
          "--non-interactive",
          // A killed run leaves its lock until it lapses; with nothing else running, the next run
          // clears it, as an operator does after a crash.
          "--force-unlock",
        ],
        dir,
        {
          DATABASE_URL: url,
          DB_DIALECT: dialect,
          NODE_ENV: "test",
          [KILL_AT_VARIABLE]: killAt,
        }
      );
    }

    it(
      "finishes, with nothing pending, a run whose process was killed after the file was recorded",
      async () => {
        const { deployed, url, other } = await readyToDelete();
        const { name } = deleteFile();
        let ledger: number | undefined;
        for (const { at, registryRow } of AFTER_THE_FILE) {
          const point =
            at === "recorded applied"
              ? `${name}: ${at}`
              : at === "registry written"
                ? at
                : `collection ${NOTES}: ${at}`;
          const killed = await migrateProcess(url, point);
          const seen = `${at}\n${killed.stdout}\n${killed.stderr}`;
          expect(killed.status, seen).not.toBe(0);
          // Killed with the file recorded: its tables are gone, the registry row stands until the
          // registry write commits, and no later run records anything new.
          expect(await deployed.tableExists(NOTES_TABLE), seen).toBe(false);
          expect((await notesLeft(deployed)).registryRow, seen).toBe(
            registryRow
          );
          ledger ??= await ledgerOf(deployed, dialect);
          expect(await ledgerOf(deployed, dialect), seen).toBe(ledger);
          expect(await otherLeft(deployed), seen).toEqual(other);
        }

        const finished = await migrateProcess(url);
        const seen = `${finished.stdout}\n${finished.stderr}`;
        expect(finished.status, seen).toBe(0);
        expect(await notesLeft(deployed), seen).toEqual(NONE);
        expect(await otherLeft(deployed), seen).toEqual(other);
        expect(await ledgerOf(deployed, dialect), seen).toBe(ledger);
      },
      12 * NEXTLY_RUN_TIMEOUT
    );

    it(
      "removes no row when the process is killed inside the file, and finishes later",
      async () => {
        const { deployed, url, notes, other } = await readyToDelete();
        const { name, drops } = deleteFile();
        // MySQL keeps each drop as it runs: one kill there, after the first drop, is resolved below.
        const points =
          dialect === "mysql"
            ? ["after statement 1"]
            : [
                "before statement 1",
                ...Array.from(
                  { length: drops },
                  (_, i) => `after statement ${i + 1}`
                ),
              ];
        for (const at of points) {
          const killed = await migrateProcess(url, `${name}: ${at}`);
          const seen = `${at}\n${killed.stdout}\n${killed.stderr}`;
          expect(killed.status, seen).not.toBe(0);
          expect(await notesLeft(deployed), seen).toEqual(notes);
          expect(await otherLeft(deployed), seen).toEqual(other);
          if (dialect !== "mysql") {
            // The file rolled back: the collection stands whole.
            expect(await deployed.tableExists(NOTES_TABLE), seen).toBe(true);
          }
        }

        if (dialect === "mysql") {
          // The next run refuses, naming the attempt, and removes nothing.
          const refused = await migrateProcess(url);
          expect(refused.status, refused.stdout).not.toBe(0);
          expect(await notesLeft(deployed)).toEqual(notes);
          // The remaining drops finished by hand, and the file recorded applied.
          await dropNotesTablesByHand(deployed);
          loaded.config = PROJECT;
          const resolved = await command(context =>
            runMigrateResolve(
              { cwd: dir, applied: name } as Parameters<
                typeof runMigrateResolve
              >[0],
              context
            )
          );
          expect(resolved.code, resolved.said).toBeUndefined();
        }

        const finished = await migrateProcess(url);
        const seen = `${finished.stdout}\n${finished.stderr}`;
        expect(finished.status, seen).toBe(0);
        expect(await deployed.tableExists(NOTES_TABLE), seen).toBe(false);
        expect(await notesLeft(deployed), seen).toEqual(NONE);
        expect(await otherLeft(deployed), seen).toEqual(other);
      },
      12 * NEXTLY_RUN_TIMEOUT
    );

    it("leaves every row, and finishes later, when the run fails inside the file", async () => {
      const { deployed, notes, other } = await readyToDelete();
      const { name, drops } = deleteFile();
      // Positive control: the file drops the collection's tables, a junction among them.
      expect(drops).toBeGreaterThanOrEqual(3);

      for (const at of [
        "before statement 1",
        ...Array.from({ length: drops }, (_, i) => `after statement ${i + 1}`),
      ]) {
        const stopped = await withStopPoints(
          point => {
            if (point === `${name}: ${at}`) throw new Error(`stopped at ${at}`);
          },
          () => migrate()
        );
        expect(stopped.code, `${at}\n${stopped.said}`).not.toBeUndefined();
        // No row is removed by a run that stopped inside the file, on any dialect.
        expect(await notesLeft(deployed), at).toEqual(notes);
        expect(await otherLeft(deployed), at).toEqual(other);
        if (dialect === "mysql") break;
        // PostgreSQL and SQLite roll the file back: the collection stands whole.
        expect(await deployed.tableExists(NOTES_TABLE), at).toBe(true);
      }

      if (dialect === "mysql") {
        // Each drop committed as it ran: the next run refuses until the file is resolved.
        const refused = await migrate();
        expect(refused.code, refused.said).not.toBeUndefined();
        expect(await notesLeft(deployed)).toEqual(notes);
        // The remaining drops finished by hand, and the file recorded applied.
        await dropNotesTablesByHand(deployed);
        loaded.config = PROJECT;
        const resolved = await command(context =>
          runMigrateResolve(
            { cwd: dir, applied: name } as Parameters<
              typeof runMigrateResolve
            >[0],
            context
          )
        );
        expect(resolved.code, resolved.said).toBeUndefined();
      }

      const finished = await migrate();
      expect(finished.code, finished.said).toBeUndefined();
      expect(await deployed.tableExists(NOTES_TABLE)).toBe(false);
      expect(await notesLeft(deployed), finished.said).toEqual(NONE);
      expect(await otherLeft(deployed)).toEqual(other);
    }, 600_000);
  }
);
