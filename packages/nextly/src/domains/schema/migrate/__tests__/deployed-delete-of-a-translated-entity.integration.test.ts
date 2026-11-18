/**
 * A translated collection, Single or field group deleted in the Schema
 * Builder is deleted on a deployed database by `nextly migrate`, as the
 * Builder deleted it in development: its tables, its translations table among
 * them, under the data-loss consent that names its table, which lists the
 * translations table with its rows beside it. `migrate:down` of the delete
 * brings the table back with an empty translations table.
 *
 * Two databases, each the commands reach through `DATABASE_URL` as an app's
 * would: the Builder's, where the entity is created and deleted in
 * development and each save writes its migration, and the deployed one, where
 * `nextly migrate` applies the create, an entry is written, and then
 * `nextly migrate` applies the delete with the data-loss consent.
 *
 * And the same for a translated code-first collection removed from the
 * config: `migrate:create` writes the drop of its translations table.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../../__tests__/helpers/fresh-database";
import { runMigrate } from "../../../../cli/commands/migrate";
import { runMigrateCreate } from "../../../../cli/commands/migrate-create";
import { runMigrateDown } from "../../../../cli/commands/migrate-down";
import type { CommandContext } from "../../../../cli/program";
import type { AcceptDataLossOption } from "../../../../cli/utils/data-loss-consent";
import { createLogger } from "../../../../cli/utils/logger";
import {
  defineCollection,
  defineConfig,
  fieldGroup,
  text,
} from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { clearServices, shutdownServices } from "../../../../di/register";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
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
import type { SingleEntryService } from "../../../singles/services/single-entry-service";
import { resolveSingleTableName } from "../../../singles/services/resolve-single-table-name";
import { resolveComponentTableName } from "../../utils/resolve-table-name";
import { setNonInteractive } from "../can-prompt";

/** The configuration the commands load. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

/**
 * Two switches over the removal of a deleted entity's leftovers, both off
 * unless a case arms them: `earlier` runs a delete as a release before the
 * removal existed did, removing none; `stop` fails the translation rows'
 * removal once, after the field-group values are removed in the same
 * transaction, as a run stopped there would.
 */
const leftovers = vi.hoisted(() => ({ earlier: false, stop: false }));
vi.mock("../dropped-entity-leftovers", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../dropped-entity-leftovers")>();
  return {
    ...actual,
    removeDroppedEntityLeftovers: (
      ...args: Parameters<typeof actual.removeDroppedEntityLeftovers>
    ) =>
      leftovers.earlier
        ? Promise.resolve([])
        : actual.removeDroppedEntityLeftovers(...args),
  };
});
vi.mock(
  "../../../i18n/migration/entity-translation-rows",
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import("../../../i18n/migration/entity-translation-rows")
      >();
    return {
      ...actual,
      removeEntityTranslationRows: (
        ...args: Parameters<typeof actual.removeEntityTranslationRows>
      ) => {
        if (leftovers.stop) {
          leftovers.stop = false;
          return Promise.reject(new Error("stopped in the translation rows"));
        }
        return actual.removeEntityTranslationRows(...args);
      },
    };
  }
);

const MIGRATIONS = "./migrations";
const DEFINITION = "./schema/builder.json";
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };
const PROJECT = defineConfig({
  collections: [],
  localization: LOCALIZATION,
  db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION },
});

const META = "dpl_meta";

/**
 * One kind of translated entity: how the Builder makes and deletes it, and
 * how an entry with a translation is written to it on the deployed site.
 */
interface Kind {
  word: string;
  table: string;
  create: () => Promise<unknown>;
  /** Writes an entry and its Spanish translation; none for a field group, which no entry owns here. */
  write?: (site: TestNextly) => Promise<void>;
  remove: () => Promise<unknown>;
}

const NOTES = "dpl_notes";
const HERO = "dpl_hero";
const CARD = "dpl_card";

const KINDS: Kind[] = [
  {
    word: "collection",
    table: `dc_${NOTES}`,
    create: async () => {
      await dispatchComponents(
        "createComponent",
        {},
        { slug: META, label: META, fields: [text({ name: "note" })] }
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
          ],
        }
      );
    },
    write: async site => {
      const entry = await site.nextly.create({
        collection: NOTES as never,
        data: { body: "Hello", meta: { note: "n" } } as never,
      });
      await site.nextly.update({
        collection: NOTES as never,
        id: (entry.item as { id: string }).id as never,
        locale: "es",
        data: { body: "Hola", _overwrite: true } as never,
      });
    },
    remove: () =>
      dispatchCollections(
        {} as ServiceContainer,
        "deleteCollection",
        { collectionName: NOTES },
        undefined
      ),
  },
  {
    word: "Single",
    table: resolveSingleTableName({ slug: HERO }),
    create: () =>
      dispatchSingles(
        "createSingle",
        {},
        {
          slug: HERO,
          label: HERO,
          localized: true,
          fields: [text({ name: "body", localized: true })],
        }
      ),
    write: async site => {
      const singles: SingleEntryService = site.getService("singleEntryService");
      for (const [locale, body] of [
        ["en", "Hello"],
        ["es", "Hola"],
      ] as const) {
        const written = await singles.update(
          HERO,
          { body, _overwrite: true },
          { overrideAccess: true, locale }
        );
        expect(written.success, JSON.stringify(written)).toBe(true);
      }
    },
    remove: () => dispatchSingles("deleteSingle", { slug: HERO }, {}),
  },
  {
    word: "field group",
    table: resolveComponentTableName(CARD),
    create: () =>
      dispatchComponents(
        "createComponent",
        {},
        {
          slug: CARD,
          label: CARD,
          localized: true,
          fields: [text({ name: "caption", localized: true })],
        }
      ),
    remove: () => dispatchComponents("deleteComponent", { slug: CARD }, {}),
  },
];

let dir: string;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-deployed-delete-"));
  mkdirSync(join(dir, "migrations"));
  // As a deploy runs it: a consent that does not cover a deletion is refused at once, never asked.
  setNonInteractive(true);
});

afterEach(async () => {
  leftovers.earlier = false;
  leftovers.stop = false;
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
    const scratch = await createScratchDatabase(dialect, `nextly_dd_${name}`);
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
  // Cleared, not shut down: shutting the services down would disconnect the
  // adapter they hold, which this test opens once per database and reuses.
  clearServices();
  clearRegistryRowCache();
  return createTestNextly({
    adapter: adapter as never,
    basePath: dir,
    db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION },
    localization: LOCALIZATION,
  });
}

/**
 * A command over the project, as the CLI runs it: its exit code (undefined
 * when it finished) and everything it said.
 */
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
  // A failure is printed rather than logged: kept, so a red names it.
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
function migrate(consent: AcceptDataLossOption = true, config = PROJECT) {
  loaded.config = config;
  return command(context =>
    runMigrate(
      { cwd: dir, acceptDataLoss: consent } as Parameters<typeof runMigrate>[0],
      context
    )
  );
}

/** `nextly migrate:down` of the last migration, with the data-loss consent. */
function migrateDown() {
  loaded.config = PROJECT;
  return command(context =>
    runMigrateDown({ cwd: dir, step: 1, acceptDataLoss: true }, context)
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

/** What `adapter` holds of `table`: whether it and its translations table stand, and the translations. */
async function leftOf(
  adapter: DrizzleAdapter,
  dialect: TestDialect,
  table: string
) {
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const companion = `${table}_locales`;
  const translationsTable = await adapter.tableExists(companion);
  return {
    table: await adapter.tableExists(table),
    translationsTable,
    translations: translationsTable
      ? Number(
          (
            await adapter.executeQuery<{ n: unknown }>(
              `SELECT COUNT(*) AS n FROM ${q(companion)}`
            )
          )[0]?.n ?? Number.NaN
        )
      : 0,
  };
}

describe.each(getConfiguredTestDialects())(
  "a translated entity deleted in the Builder, on a deployed database (%s)",
  dialect => {
    /**
     * Create the entity in the Builder, apply it to the deployed database with
     * an entry there, delete it in the Builder, and apply the delete to the
     * deployed database with `consent`: what that run answered, and what it
     * left, with the deployed database to go on from.
     */
    async function deleteOnTheDeployedDatabase(
      kind: Kind,
      consent: AcceptDataLossOption = true
    ) {
      const own = await openDatabase(dialect, "builder");
      const deployed = await openDatabase(dialect, "deployed");

      reach(dialect, own.url);
      await start(own.adapter);
      await builder(kind.create);

      // The deploy: the create applied, then an entry written with a translation.
      reach(dialect, deployed.url);
      await start(deployed.adapter);
      const created = await migrate();
      expect(created.code, created.said).toBeUndefined();
      if (kind.write !== undefined) {
        await kind.write(await start(deployed.adapter));
      }
      const before = await leftOf(deployed.adapter, dialect, kind.table);

      // Deleted in the Builder, which writes the delete's migration.
      reach(dialect, own.url);
      await start(own.adapter);
      await builder(kind.remove);

      // The deploy of the delete.
      reach(dialect, deployed.url);
      await start(deployed.adapter);
      const deleted = await migrate(consent);
      const after = await leftOf(deployed.adapter, dialect, kind.table);
      return { before, deleted, after, deployed };
    }

    describe.each(KINDS)("a $word", kind => {
      it("drops its tables, its translations table among them", async () => {
        const { before, deleted, after } =
          await deleteOnTheDeployedDatabase(kind);
        // Positive control: the deployed database held both.
        expect(before).toMatchObject({ table: true, translationsTable: true });
        const seen = JSON.stringify({ code: deleted.code, before, after });

        expect(deleted.code, `${seen}\n${deleted.said}`).toBeUndefined();
        expect(
          { table: after.table, translationsTable: after.translationsTable },
          seen
        ).toEqual({ table: false, translationsTable: false });
      }, 180_000);

      it("takes the translations table under a consent naming its table", async () => {
        // The translations table is part of the entity's storage: naming the
        // entity's table consents to losing both.
        const { before, deleted, after } = await deleteOnTheDeployedDatabase(
          kind,
          kind.table
        );
        expect(before).toMatchObject({ table: true, translationsTable: true });
        const seen = JSON.stringify({ code: deleted.code, before, after });

        expect(deleted.code, `${seen}\n${deleted.said}`).toBeUndefined();
        expect(
          { table: after.table, translationsTable: after.translationsTable },
          seen
        ).toEqual({ table: false, translationsTable: false });
      }, 180_000);

      it("comes back by migrate:down with its table and an empty translations table", async () => {
        const {
          deleted,
          after: gone,
          deployed,
        } = await deleteOnTheDeployedDatabase(kind);
        expect(deleted.code, deleted.said).toBeUndefined();
        // The delete took both tables, so whatever stands after the DOWN is the DOWN's.
        expect(gone, deleted.said).toMatchObject({
          table: false,
          translationsTable: false,
        });

        const down = await migrateDown();
        const after = await leftOf(deployed.adapter, dialect, kind.table);

        expect(down.code, down.said).toBeUndefined();
        // The translations the delete took are not in the file to bring back.
        expect(after, down.said).toEqual({
          table: true,
          translationsTable: true,
          translations: 0,
        });
      }, 180_000);
    });

    it("lists a collection's translations table right after its table", async () => {
      const notes = KINDS[0]!;
      const { before, deleted } = await deleteOnTheDeployedDatabase(notes);
      // Positive control: the translations table held the two languages' rows.
      expect(before.translations).toBe(2);
      expect(deleted.code, deleted.said).toBeUndefined();

      // The file drops the translations table first; the listing reads it beside its table.
      // `nextly migrate` lists a file's drops without counting their rows.
      const lines = deleted.said.split("\n").map(line => line.trim());
      const at = lines.indexOf(`- table ${notes.table}`);
      expect(at, deleted.said).toBeGreaterThanOrEqual(0);
      expect(lines[at + 1], deleted.said).toBe(
        `- table ${notes.table}_locales`
      );
    }, 180_000);

    it("refuses a collection's delete, changing nothing, under a consent that names another table", async () => {
      const notes = KINDS[0]!;
      const { before, deleted, after } = await deleteOnTheDeployedDatabase(
        notes,
        "dpl_another"
      );
      const seen = JSON.stringify({ code: deleted.code, before, after });

      expect(deleted.code, `${seen}\n${deleted.said}`).not.toBeUndefined();
      // Refused before anything runs: the collection and its translations
      // stand as they were.
      expect(after, seen).toEqual(before);
      // Refused by the consent, naming what it does not cover, not by a
      // failure of the file.
      expect(deleted.said).toContain("The consent given does not cover");
      expect(deleted.said).toContain(notes.table);
    }, 180_000);
  }
);

describe.skipIf(!getConfiguredTestDialects().includes("sqlite"))(
  "a translated code-first collection removed from the config (sqlite)",
  () => {
    const LETTERS = "cf_letters";
    const LETTERS_TABLE = `dc_${LETTERS}`;
    const withLetters = defineConfig({
      collections: [
        defineCollection({
          slug: LETTERS,
          localized: true,
          fields: [text({ name: "body", localized: true })],
        }),
      ],
      localization: LOCALIZATION,
      db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION },
    });

    /** `nextly migrate:create` over `config`. */
    function migrateCreate(name: string, config: unknown) {
      loaded.config = config;
      return command(context =>
        runMigrateCreate(
          name,
          { cwd: dir, acceptDataLoss: true } as Parameters<
            typeof runMigrateCreate
          >[1],
          context
        )
      );
    }

    it("writes the drop of its translations table, which the deployed run applies", async () => {
      const site = await openDatabase("sqlite", "deployed");
      reach("sqlite", site.url);

      const created = await migrateCreate("add_letters", withLetters);
      expect(created.code, created.said).toBeUndefined();
      const applied = await migrate(true, withLetters);
      expect(applied.code, applied.said).toBeUndefined();
      // Positive control: the create made both tables.
      expect(await leftOf(site.adapter, "sqlite", LETTERS_TABLE)).toMatchObject(
        { table: true, translationsTable: true }
      );

      const removed = await migrateCreate("remove_letters", PROJECT);
      expect(removed.code, removed.said).toBeUndefined();
      const file = readdirSync(join(dir, "migrations"))
        .filter(name => name.endsWith("_remove_letters.sql"))
        .map(name => readFileSync(join(dir, "migrations", name), "utf8"))[0];
      expect(file, removed.said).toBeDefined();
      const up = (file ?? "").split(/^-- (?:DOWN|down)\b/m)[0] ?? "";
      const dropsTranslations = up.indexOf(
        `DROP TABLE IF EXISTS "${LETTERS_TABLE}_locales"`
      );
      const dropsTable = up.indexOf(`DROP TABLE "${LETTERS_TABLE}"`);
      // Both dropped, the translations table first.
      expect(dropsTranslations, file).toBeGreaterThanOrEqual(0);
      expect(dropsTable, file).toBeGreaterThan(dropsTranslations);

      const deleted = await migrate(true, PROJECT);
      expect(deleted.code, deleted.said).toBeUndefined();
      expect(await leftOf(site.adapter, "sqlite", LETTERS_TABLE)).toEqual({
        table: false,
        translationsTable: false,
        translations: 0,
      });
    }, 180_000);
  }
);

describe.each(getConfiguredTestDialects())(
  "what a deleted translated collection left, on a deployed database (%s)",
  dialect => {
    const KEPT = "dpl_kept";
    const META_TABLE = resolveComponentTableName(META);
    const notes = KINDS[0]!;

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    /** What `adapter` holds of NOTES in the tables every entity shares, and KEPT's field-group values. */
    async function sharedLeftOf(adapter: DrizzleAdapter) {
      const count = async (sql: string) =>
        Number(
          (await adapter.executeQuery<{ n: unknown }>(sql))[0]?.n ?? Number.NaN
        );
      const valuesOf = (table: string) =>
        count(
          `SELECT COUNT(*) AS n FROM ${q(META_TABLE)} WHERE ${q("_parent_table")} = '${table}'`
        );
      return {
        registryRow: await count(
          `SELECT COUNT(*) AS n FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${NOTES}'`
        ),
        values: await valuesOf(notes.table),
        archiveRows: (await adapter.tableExists("nextly_i18n_archive"))
          ? await count(
              `SELECT COUNT(*) AS n FROM ${q("nextly_i18n_archive")} WHERE ${q("collection")} = '${NOTES}'`
            )
          : 0,
        keptValues: await valuesOf(`dc_${KEPT}`),
      };
    }

    /**
     * NOTES and KEPT, both placing the META field group, made in the Builder
     * and applied to the deployed database, each with an entry there, NOTES's
     * translated and with an archived translation; then NOTES deleted in the
     * Builder and the delete applied by `nextly migrate`.
     */
    async function deleteNotesOnTheDeployedDatabase(
      /** Run just before the delete is applied: a switch armed for that run alone. */
      arm: () => void = () => {}
    ) {
      const own = await openDatabase(dialect, "builder");
      const deployed = await openDatabase(dialect, "deployed");

      reach(dialect, own.url);
      await start(own.adapter);
      await builder(async () => {
        await notes.create();
        await dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          {
            name: KEPT,
            label: KEPT,
            fields: [fieldGroup({ name: "meta", component: META })],
          }
        );
      });

      reach(dialect, deployed.url);
      await start(deployed.adapter);
      const created = await migrate();
      expect(created.code, created.said).toBeUndefined();
      const site = await start(deployed.adapter);
      await notes.write?.(site);
      await site.nextly.create({
        collection: KEPT as never,
        data: { meta: { note: "kept" } } as never,
      });
      await ensureI18nArchive(deployed.adapter, dialect);
      await deployed.adapter.insert("nextly_i18n_archive", {
        collection: NOTES,
        entityKind: "collection",
        entryId: "an-entry",
        locale: "es",
        field: "body",
        value: "Hola",
        archivedAt: new Date(),
      });
      const before = await sharedLeftOf(deployed.adapter);

      reach(dialect, own.url);
      await start(own.adapter);
      await builder(notes.remove);

      reach(dialect, deployed.url);
      await start(deployed.adapter);
      arm();
      const deleted = await migrate();
      const after = await sharedLeftOf(deployed.adapter);
      return { deployed, before, deleted, after };
    }

    /** The run's line naming what it removed of NOTES. */
    const removedLine = new RegExp(
      `Removed what the deleted collection "${NOTES}" left: 1 field group value, [1-9]\\d* translation rows?\\.`
    );

    it("removes its field-group values and translation rows once it is gone, naming it, and leaves another's", async () => {
      const { before, deleted, after } =
        await deleteNotesOnTheDeployedDatabase();
      // Positive control: the deployed database held each of them.
      expect(before).toMatchObject({
        registryRow: 1,
        values: 1,
        archiveRows: 1,
      });
      expect(before.keptValues).toBe(1);

      expect(deleted.code, deleted.said).toBeUndefined();
      expect(after, deleted.said).toEqual({
        registryRow: 0,
        values: 0,
        archiveRows: 0,
        keptValues: 1,
      });
      expect(deleted.said).toMatch(removedLine);
    }, 180_000);

    it("removes what an earlier delete left on a later run with nothing to apply", async () => {
      // The delete applied as a release before the removal existed applied it.
      const { deployed, deleted, after } =
        await deleteNotesOnTheDeployedDatabase(() => {
          leftovers.earlier = true;
        });
      leftovers.earlier = false;
      expect(deleted.code, deleted.said).toBeUndefined();
      // Positive control: the earlier delete removed the row and left the rest.
      expect(after).toMatchObject({
        registryRow: 0,
        values: 1,
        archiveRows: 1,
      });

      const later = await migrate();
      const cleaned = await sharedLeftOf(deployed.adapter);

      expect(later.code, later.said).toBeUndefined();
      expect(cleaned, later.said).toEqual({
        registryRow: 0,
        values: 0,
        archiveRows: 0,
        keptValues: 1,
      });
      expect(later.said).toMatch(removedLine);
    }, 180_000);

    it("leaves a deleted collection's rows while a table stands under its name, and removes them once it is gone", async () => {
      const { deployed, after } = await deleteNotesOnTheDeployedDatabase(() => {
        leftovers.earlier = true;
      });
      leftovers.earlier = false;
      // Positive control: the earlier delete left them.
      expect(after).toMatchObject({
        registryRow: 0,
        values: 1,
        archiveRows: 1,
      });
      // A table under the deleted collection's name: its rows may be that table's.
      await deployed.adapter.executeQuery(
        `CREATE TABLE ${q(notes.table)} (${q("id")} VARCHAR(36))`
      );

      const standing = await migrate();
      expect(standing.code, standing.said).toBeUndefined();
      expect(await sharedLeftOf(deployed.adapter), standing.said).toEqual(
        after
      );
      expect(standing.said).not.toMatch(removedLine);

      await deployed.adapter.executeQuery(`DROP TABLE ${q(notes.table)}`);
      const gone = await migrate();
      expect(await sharedLeftOf(deployed.adapter), gone.said).toEqual({
        registryRow: 0,
        values: 0,
        archiveRows: 0,
        keptValues: 1,
      });
      expect(gone.said).toMatch(removedLine);
    }, 180_000);

    it("removes none of its rows in a run stopped part-way through them, and all of them in the next", async () => {
      const { deployed, before, deleted, after } =
        await deleteNotesOnTheDeployedDatabase(() => {
          leftovers.stop = true;
        });
      expect(leftovers.stop, "the stop was reached").toBe(false);
      expect(deleted.code, deleted.said).toBeUndefined();
      // The field-group values went first in the same transaction, and came back with it.
      expect(after, deleted.said).toEqual({ ...before, registryRow: 0 });
      expect(deleted.said).toContain(
        `Could not remove what the deleted collection "${NOTES}" left`
      );

      const next = await migrate();
      const cleaned = await sharedLeftOf(deployed.adapter);

      expect(next.code, next.said).toBeUndefined();
      expect(cleaned, next.said).toEqual({
        registryRow: 0,
        values: 0,
        archiveRows: 0,
        keptValues: 1,
      });
    }, 180_000);
  }
);
