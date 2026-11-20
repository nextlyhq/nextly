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
 * - A repair that fails while the archive holds rows it would hand back to the labelling (rows an
 *   earlier labelling settled unresolved by a date in milliseconds) stops the run as well.
 * - A repair that fails where nothing would be labelled (no archived translation of unknown kind,
 *   or inside a registry write the caller holds open) warns, hands the repair back to the next
 *   start and carries on.
 * - A run that lost the schema lock stops before the repair writes anything.
 * - A holder whose creation time cannot be read as a date leaves its rows unknown, and a run once
 *   it can labels them.
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
import { isSchemaLockLost } from "../../pipeline/schema-lock";
import { writeRegistryRows } from "../../schema-version";
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

/** Whether the run has lost the schema lock, as the pass's next check of it finds. */
const lock = vi.hoisted(() => ({ lost: false }));
vi.mock("../../pipeline/schema-lock", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../../pipeline/schema-lock")>();
  return {
    ...actual,
    assertSchemaLockHeld: async () => {
      if (lock.lost) throw actual.lostLockError("nextly migrate");
      await actual.assertSchemaLockHeld();
    },
  };
});

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
    lock.lost = false;
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
  /**
   * The dropped collection's registry row, still there: the registry write removes it. Written in
   * seconds, or in milliseconds as the migration file of an earlier release wrote it.
   */
  const registerDropped = ({ inMilliseconds = false } = {}) => {
    const upsert = buildCollectionMetadataUpsert(
      { ...declared, slug: DROPPED } as never,
      "sqlite"
    );
    return adapter.executeQuery(
      inMilliseconds ? asAnOlderFileWroteIt(upsert) : upsert
    );
  };
  /** A start that already marked both repairs done. */
  const markBothRepairsDone = () =>
    adapter.executeQuery(
      `INSERT INTO nextly_meta (key, value, updated_at) VALUES ('${TIMESTAMP_REPAIR_META_KEY}', '${JSON.stringify({ at: "2026-11-01T00:00:00.000Z", registries: true })}', unixepoch())`
    );
  /** The start's mark as stored. */
  const mark = async () => {
    const [row] = await adapter.executeQuery<{ value: string }>(
      `SELECT value FROM nextly_meta WHERE key = '${TIMESTAMP_REPAIR_META_KEY}'`
    );
    return JSON.parse(row.value) as unknown;
  };

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
    // The dropped collection's archived translations can be labelled only while its registry row
    // is there.
    await registerDropped();
    await adapter.executeQuery(
      `INSERT INTO "nextly_i18n_archive" ("collection", "entity_kind", "entry_id", "locale", "field", "value", "archived_at") VALUES ('${DROPPED}', 'unknown', 'd1', 'fr', 'title', 'Salut', unixepoch() + 3600)`
    );
    await archive("unknown", "e1");
    await markBothRepairsDone();
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
    expect(await mark()).toBe("2026-11-01T00:00:00.000Z");

    // The next run, its repair working, labels both collections' rows while the dropped one's
    // registry row is still there, and only then removes that row. Its archived translations,
    // labelled, then go with what it left; unlabelled, they would be kept, unresolved, for good.
    repair.fails = false;
    await migrate();
    expect(await kindOf(SLUG)).toEqual(["collection"]);
    expect(await registered()).toEqual([SLUG]);
    expect(await kindOf(DROPPED)).toEqual([]);
  });

  it("a repair that fails where no archived translation is of unknown kind warns, and the run goes on", async () => {
    await registerDropped();
    await archive("collection", "e1");
    await markBothRepairsDone();
    repair.fails = true;

    await migrate();
    // Nothing waits to be labelled, so the registry write goes ahead: the dropped row goes.
    expect(await registered()).toEqual([SLUG]);
    expect(await kindOf(SLUG)).toEqual(["collection"]);
    expect(
      warnings.filter(message => message.includes("milliseconds"))
    ).toHaveLength(1);
    expect(await mark()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("a repair that fails inside a registry write the caller holds open warns, and the run goes on unlabelled", async () => {
    await archive("unknown", "e1");
    await markBothRepairsDone();
    repair.fails = true;

    await writeRegistryRows(adapter, () => migrate());
    // The labelling never runs inside such a write, so the rows wait, unknown, for the next run,
    // and the mark handed back to the next start is committed with the write.
    expect(await kindOf(SLUG)).toEqual(["unknown"]);
    expect(
      warnings.filter(message => message.includes("milliseconds"))
    ).toHaveLength(1);
    expect(await mark()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("a run that lost the schema lock stops before the repair writes anything", async () => {
    await archive("unknown", "e1");
    lock.lost = true;

    const outcome = await migrate().then(
      () => "completed",
      (error: unknown) => error
    );
    expect(isSchemaLockLost(outcome)).toBe(true);
    // The registry row is still as the older file wrote it, and nothing was labelled.
    expect(await createdAt()).toBeGreaterThan(1e11);
    expect(await kinds()).toEqual(["unknown"]);
  });

  it("leaves the rows of a holder whose creation time cannot be read unknown, and labels them once it can", async () => {
    // Text that is no date: the driver reads it back as an invalid one, against which no row
    // can be judged.
    await adapter.executeQuery(
      `UPDATE dynamic_collections SET created_at = 'not a date' WHERE slug = '${SLUG}'`
    );
    await archive("unknown", "e1");

    await migrate();
    // Neither labelled nor settled unresolved for good: the rows wait.
    expect(await kinds()).toEqual(["unknown"]);

    await adapter.executeQuery(
      `UPDATE dynamic_collections SET created_at = unixepoch() - 60 WHERE slug = '${SLUG}'`
    );
    await migrate();
    expect(await kinds()).toEqual(["collection"]);
  });

  it("a repair that fails while rows it would hand back to the labelling are unresolved stops the run too", async () => {
    // An earlier labelling read the dropped collection's creation date in milliseconds and
    // settled its row unresolved: only the repair hands it back, and only while that registry row
    // is there to label it by.
    await registerDropped({ inMilliseconds: true });
    await adapter.executeQuery(
      `INSERT INTO "nextly_i18n_archive" ("collection", "entity_kind", "entry_id", "locale", "field", "value", "archived_at") VALUES ('${DROPPED}', 'unresolved', 'd1', 'fr', 'title', 'Salut', unixepoch() + 3600)`
    );
    repair.fails = true;

    const outcome = await migrate().then(
      () => "completed",
      (error: unknown) => error
    );
    expect(await registered()).toEqual([DROPPED, SLUG].sort());
    expect(await kindOf(DROPPED)).toEqual(["unresolved"]);
    expect(outcome).toBeInstanceOf(Error);

    // The next run, its repair working, hands the row back, labels it while the dropped row is
    // there, then removes that row and, with what the collection left, the labelled row.
    repair.fails = false;
    await migrate();
    expect(await registered()).toEqual([SLUG]);
    expect(await kindOf(DROPPED)).toEqual([]);
  });
});
