/**
 * On SQLite, `nextly migrate`'s registry phase repairs the registries' timestamps before it labels
 * archived translations, on a real SQLite database.
 *
 * - A registry row a migration file of an earlier release wrote in milliseconds is repaired, and
 *   the same run then gives its entity's archived translations their owner's kind: rows still
 *   unknown, and rows an earlier labelling marked unresolved while the date was wrong.
 * - A repair that fails stops the run before the registry changes, in a run that drops an entity
 *   too, and hands the registries' repair back to the next start; the next run repairs, labels
 *   and only then removes the dropped entity's row.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { installRegistryResolver } from "../../../../cli/utils/registry-resolver";
import { createAdapter } from "../../../../database/factory";
import { TIMESTAMP_REPAIR_META_KEY } from "../../../../database/repair-sqlite-timestamps";
import { shutdownServices } from "../../../../di/register";
import { createTestNextly } from "../../../../plugins/test-nextly";
import { getI18nArchiveDdl } from "../../../../schemas/nextly-i18n-archive/ddl";
import { ensureSchemaEventsTable } from "../../events/schema-events-ddl";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { recordedSnapshot } from "../../migrate-create/__tests__/helpers/recorded-snapshot";
import { EMPTY_SNAPSHOT } from "../../migrate-create/snapshot-io";
import { buildCollectionMetadataUpsert } from "../../ui-schema/metadata-sql";
import { reconcileMigrationMetadata } from "../reconcile-metadata";

/** Whether the registries' repair fails when the registry phase runs it. */
const repair = vi.hoisted(() => ({ fails: false }));
vi.mock(
  "../../../../database/repair-sqlite-registry-timestamps",
  async importOriginal => {
    const original =
      await importOriginal<
        typeof import("../../../../database/repair-sqlite-registry-timestamps")
      >();
    return {
      ...original,
      repairSqliteRegistryTimestamps: (
        ...args: Parameters<typeof original.repairSqliteRegistryTimestamps>
      ) => {
        if (repair.fails) {
          return Promise.reject(new Error("the registries could not be read"));
        }
        return original.repairSqliteRegistryTimestamps(...args);
      },
    };
  }
);

const SECONDS = "CAST(strftime('%s','now') AS INTEGER)";
const SLUG = "rlar_posts";
/** A collection the applied migrations dropped: the earlier one records it, the newer does not. */
const DROPPED = "rlar_dropped";
const EARLIER = "20260101_000000_000_rlar";
const MIGRATION = "20260102_000000_000_rlar";

/** A registry-row statement as a migration file generated before the seconds fix holds it. */
const asAnOlderFileWroteIt = (statement: string): string =>
  statement.replaceAll(SECONDS, `${SECONDS} * 1000`);

const declared = {
  slug: SLUG,
  labels: { singular: "Post", plural: "Posts" },
  fields: [{ name: "title", type: "text" }],
};

describe("nextly migrate's registry phase on SQLite, with a registry row in milliseconds", () => {
  let dir: string;
  let url: string;
  let adapter: DrizzleAdapter;
  let migrations: string;
  const warnings: string[] = [];
  const logger = {
    info: () => {},
    debug: () => {},
    warn: (message: string) => {
      warnings.push(message);
    },
  };

  const adapterFor = (): Promise<DrizzleAdapter> =>
    createAdapter({ type: "sqlite", url } as Parameters<
      typeof createAdapter
    >[0]) as Promise<DrizzleAdapter>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nextly-rlar-"));
    url = `file:${join(dir, "rlar.db")}`;
    const core = await createTestNextly({
      adapter: (await adapterFor()) as never,
    });
    await core.destroy();
    adapter = await adapterFor();
    installRegistryResolver(adapter);
    for (const statement of getI18nArchiveDdl("sqlite")) {
      await adapter.executeQuery(statement);
    }
    await ensureSchemaEventsTable(adapter);
    // Two applied migrations: the earlier records both collections, the newer only the one that
    // stays, so the registry phase labels by the collection's row and removes the dropped one's.
    migrations = mkdtempSync(join(tmpdir(), "nextly-rlar-migrations-"));
    const events = new SchemaEventsRepository(adapter.getDrizzle(), "sqlite");
    for (const [name, slugs] of [
      [EARLIER, [SLUG, DROPPED]],
      [MIGRATION, [SLUG]],
    ] as const) {
      await recordedSnapshot(
        join(migrations, "meta"),
        name,
        EMPTY_SNAPSHOT,
        "",
        {},
        {
          collections: Object.fromEntries(
            slugs.map(slug => [
              slug,
              { source: "builder", settings: { ...declared, slug } },
            ])
          ),
          singles: {},
          fieldGroups: {},
        }
      );
      await events.insertEvent({
        eventType: "file_apply",
        source: "cli-migrate",
        status: "applied",
        filename: `${name}.sql`,
        endedAt: new Date(),
      });
    }
  }, 180_000);

  afterAll(async () => {
    try {
      await adapter?.disconnect().catch(() => {});
      await shutdownServices();
      rmSync(migrations, { recursive: true, force: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    repair.fails = false;
    warnings.length = 0;
    await adapter.executeQuery(
      `DELETE FROM dynamic_collections WHERE slug LIKE 'rlar_%'`
    );
    await adapter.executeQuery(`DELETE FROM "nextly_i18n_archive"`);
    await adapter.executeQuery(
      `DELETE FROM nextly_meta WHERE key = '${TIMESTAMP_REPAIR_META_KEY}'`
    );
    // The collection's registry row, as the migration file of an earlier release wrote it.
    await adapter.executeQuery(
      asAnOlderFileWroteIt(
        buildCollectionMetadataUpsert(declared as never, "sqlite")
      )
    );
  });

  const archive = (kind: string, entry: string) =>
    adapter.executeQuery(
      `INSERT INTO "nextly_i18n_archive" ("collection", "entity_kind", "entry_id", "locale", "field", "value", "archived_at") VALUES ('${SLUG}', '${kind}', '${entry}', 'fr', 'title', 'Bonjour', unixepoch() + 3600)`
    );
  const kinds = async () =>
    (
      await adapter.executeQuery<{ entity_kind: string }>(
        `SELECT entity_kind FROM "nextly_i18n_archive" ORDER BY entry_id`
      )
    ).map(row => row.entity_kind);
  const createdAt = async () =>
    (
      await adapter.executeQuery<{ created_at: number }>(
        `SELECT created_at FROM dynamic_collections WHERE slug = '${SLUG}'`
      )
    )[0].created_at;
  const migrate = () =>
    reconcileMigrationMetadata({
      adapter,
      dialect: "sqlite",
      migrationsDir: migrations,
      logger,
    });

  it("repairs the row, then labels its archived translations, in the one run", async () => {
    await archive("unknown", "e1");
    await archive("unresolved", "e2");
    expect(await createdAt()).toBeGreaterThan(1e11);

    await migrate();
    expect(await createdAt()).toBeLessThan(1e11);
    expect(await kinds()).toEqual(["collection", "collection"]);

    // A second run finds nothing to repair and nothing left to label.
    await migrate();
    expect(await kinds()).toEqual(["collection", "collection"]);
  });

  it("a repair that fails stops the run before the registry changes, and the next run repairs, labels and writes", async () => {
    // The dropped collection's registry row, still there: the registry write removes it, and its
    // archived translations can be labelled only while it is there.
    await adapter.executeQuery(
      buildCollectionMetadataUpsert(
        { ...declared, slug: DROPPED } as never,
        "sqlite"
      )
    );
    await adapter.executeQuery(
      `INSERT INTO "nextly_i18n_archive" ("collection", "entity_kind", "entry_id", "locale", "field", "value", "archived_at") VALUES ('${DROPPED}', 'unknown', 'd1', 'fr', 'title', 'Salut', unixepoch() + 3600)`
    );
    await archive("unknown", "e1");
    const registered = async () =>
      (
        await adapter.executeQuery<{ slug: string }>(
          `SELECT slug FROM dynamic_collections WHERE slug IN ('${SLUG}', '${DROPPED}') ORDER BY slug`
        )
      ).map(row => row.slug);
    const kindOf = async (slug: string) =>
      (
        await adapter.executeQuery<{ entity_kind: string }>(
          `SELECT entity_kind FROM "nextly_i18n_archive" WHERE collection = '${slug}'`
        )
      ).map(row => row.entity_kind);
    // A start already marked both repairs done.
    await adapter.executeQuery(
      `INSERT INTO nextly_meta (key, value, updated_at) VALUES ('${TIMESTAMP_REPAIR_META_KEY}', '${JSON.stringify({ at: "2026-11-01T00:00:00.000Z", registries: true })}', unixepoch())`
    );
    repair.fails = true;

    const outcome = await migrate().then(
      () => "completed",
      (error: unknown) => error
    );
    // Nothing of the registry changed, and nothing was labelled by a date that is still wrong.
    expect(await registered()).toEqual([DROPPED, SLUG].sort());
    expect(await kindOf(DROPPED)).toEqual(["unknown"]);
    expect(await kindOf(SLUG)).toEqual(["unknown"]);
    // The pass fails, as a labelling that fails does, with the repair's own error, and says why.
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe("the registries could not be read");
    expect(
      warnings.filter(message => message.includes("milliseconds"))
    ).toHaveLength(1);
    // The mark says the registries' repair is owed again, and the text repair is not.
    const [mark] = await adapter.executeQuery<{ value: string }>(
      `SELECT value FROM nextly_meta WHERE key = '${TIMESTAMP_REPAIR_META_KEY}'`
    );
    expect(JSON.parse(mark.value)).toBe("2026-11-01T00:00:00.000Z");

    // The next run, its repair working, labels both collections' rows while the dropped one's
    // registry row is still there, and only then removes that row. Its archived translations,
    // labelled, then go with what it left; unlabelled, they would be kept, unresolved, for good.
    repair.fails = false;
    await migrate();
    expect(await kindOf(SLUG)).toEqual(["collection"]);
    expect(await registered()).toEqual([SLUG]);
    expect(await kindOf(DROPPED)).toEqual([]);
  });
});
