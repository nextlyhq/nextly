/**
 * A translated collection deleted in the Schema Builder is deleted on a
 * deployed database by `nextly migrate`, as the Builder deleted it in
 * development: its tables, its translations table among them, and every row
 * it owned elsewhere.
 *
 * Two databases, each the commands reach through `DATABASE_URL` as an app's
 * would: the Builder's, where the collection is created and deleted in
 * development and each save writes its migration, and the deployed one, where
 * `nextly migrate` applies the create, an entry is written, and then
 * `nextly migrate` applies the delete with the data-loss consent.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../../__tests__/helpers/fresh-database";
import { runMigrate } from "../../../../cli/commands/migrate";
import type { CommandContext } from "../../../../cli/program";
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
import { resolveComponentTableName } from "../../utils/resolve-table-name";

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

const NOTES = "dpl_notes";
const NOTES_TABLE = `dc_${NOTES}`;
const META = "dpl_meta";
const META_TABLE = resolveComponentTableName(META);

let dir: string;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-deployed-delete-"));
  mkdirSync(join(dir, "migrations"));
});

afterEach(async () => {
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

/** `nextly migrate` over the project, with the data-loss consent: its exit code and what it said. */
async function migrate(): Promise<{ code: number | undefined; said: string }> {
  loaded.config = PROJECT;
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
    await runMigrate(
      { cwd: dir, acceptDataLoss: true } as Parameters<typeof runMigrate>[0],
      context
    );
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

/** The Builder's own saves, in development, as its dialogs send them. */
async function builder<T>(work: () => Promise<T>): Promise<T> {
  vi.stubEnv("NODE_ENV", "development");
  try {
    return await work();
  } finally {
    vi.stubEnv("NODE_ENV", "test");
  }
}

/** What the deployed database holds of NOTES. */
async function leftOf(adapter: DrizzleAdapter, dialect: TestDialect) {
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const count = async (sql: string) =>
    Number(
      (await adapter.executeQuery<{ n: unknown }>(sql))[0]?.n ?? Number.NaN
    );
  const companion = `${NOTES_TABLE}_locales`;
  return {
    table: await adapter.tableExists(NOTES_TABLE),
    translationsTable: await adapter.tableExists(companion),
    translations: (await adapter.tableExists(companion))
      ? await count(`SELECT COUNT(*) AS n FROM ${q(companion)}`)
      : 0,
    registryRow: await count(
      `SELECT COUNT(*) AS n FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${NOTES}'`
    ),
    fieldGroupValues: await count(
      `SELECT COUNT(*) AS n FROM ${q(META_TABLE)} WHERE ${q("_parent_table")} = '${NOTES_TABLE}'`
    ),
    archiveRows: (await adapter.tableExists("nextly_i18n_archive"))
      ? await count(
          `SELECT COUNT(*) AS n FROM ${q("nextly_i18n_archive")} WHERE ${q("collection")} = '${NOTES}'`
        )
      : 0,
  };
}

describe.each(getConfiguredTestDialects())(
  "a translated collection deleted in the Builder, on a deployed database (%s)",
  dialect => {
    /**
     * Create NOTES in the Builder, apply it to the deployed database with an
     * entry there, delete NOTES in the Builder, and apply the delete to the
     * deployed database: what that run answered, and what it left.
     */
    async function deleteOnTheDeployedDatabase() {
      const own = await openDatabase(dialect, "builder");
      const deployed = await openDatabase(dialect, "deployed");

      reach(dialect, own.url);
      await start(own.adapter);
      await builder(async () => {
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
      });

      // The deploy: the create applied, then an entry written, with a
      // translation and a field-group value, and an archived translation.
      reach(dialect, deployed.url);
      await start(deployed.adapter);
      const created = await migrate();
      expect(created.code, created.said).toBeUndefined();
      const site = await start(deployed.adapter);
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
      await ensureI18nArchive(deployed.adapter, dialect);
      await deployed.adapter.insert("nextly_i18n_archive", {
        collection: NOTES,
        entityKind: "collection",
        entryId: (entry.item as { id: string }).id,
        locale: "es",
        field: "body",
        value: "Hola",
        archivedAt: new Date(),
      });
      const before = await leftOf(deployed.adapter, dialect);

      // Deleted in the Builder, which writes the delete's migration.
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

      // The deploy of the delete.
      reach(dialect, deployed.url);
      await start(deployed.adapter);
      const deleted = await migrate();
      const after = await leftOf(deployed.adapter, dialect);
      return { before, deleted, after };
    }

    it("drops its tables, its translations table among them", async () => {
      const { before, deleted, after } = await deleteOnTheDeployedDatabase();
      // Positive control: the deployed database held each of them.
      expect(before).toMatchObject({
        table: true,
        translationsTable: true,
      });
      const seen = JSON.stringify({ code: deleted.code, before, after });

      expect(deleted.code, `${seen}\n${deleted.said}`).toBeUndefined();
      expect(
        { table: after.table, translationsTable: after.translationsTable },
        seen
      ).toEqual({ table: false, translationsTable: false });
    }, 180_000);

    it("leaves nothing else it owned", async () => {
      const { before, deleted, after } = await deleteOnTheDeployedDatabase();
      // Positive control: the deployed database held each of them.
      expect(before.registryRow).toBe(1);
      expect(before.fieldGroupValues).toBeGreaterThan(0);
      expect(before.archiveRows).toBe(1);
      const seen = JSON.stringify({ code: deleted.code, before, after });

      expect(
        {
          registryRow: after.registryRow,
          fieldGroupValues: after.fieldGroupValues,
          archiveRows: after.archiveRows,
        },
        `${seen}\n${deleted.said}`
      ).toEqual({ registryRow: 0, fieldGroupValues: 0, archiveRows: 0 });
    }, 180_000);
  }
);
