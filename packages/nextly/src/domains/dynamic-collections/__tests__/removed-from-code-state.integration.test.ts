/**
 * The admin's listings and schema reads mark a collection and a Single removed
 * from code, with where each one's retirement stands, read from the real
 * database, the app's migrations folder and the migration ledger.
 *
 * Each case boots the app with the two declared, then boots again on the same
 * database with them removed from the configuration, as a deploy of the edited
 * configuration does, and stages one state:
 *
 * - their tables kept and no migration dropping them;
 * - a written migration dropping each, not applied;
 * - an applied migration that dropped each main table, the registry rows still
 *   there (half-retired);
 * - and, as the boundary of what this names, an attempt to apply the drop that
 *   stopped, which names none of those steps.
 *
 * A collection and a Single the configuration still declares are read beside
 * them, unmarked.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../database/test-database-ddl";
import { clearServices } from "../../../di/register";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { setHandlerConfig } from "../../../route-handler/auth-handler";
import { ServiceContainer } from "../../../services/index";
import { _resetEnvCache } from "../../../shared/lib/env";
import { ensureSchemaEventsTable } from "../../schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../schema/events/schema-events-repository";

const REMOVED = { collection: "rs_pages", single: "rs_banner" } as const;
const DECLARED = { collection: "rs_posts", single: "rs_settings" } as const;

const page = (slug: string) =>
  defineCollection({ slug, fields: [text({ name: "title" })] });
const banner = (slug: string) =>
  defineSingle({ slug, fields: [text({ name: "headline" })] });

const WITH_REMOVED = {
  collections: [page(REMOVED.collection), page(DECLARED.collection)],
  singles: [banner(REMOVED.single), banner(DECLARED.single)],
};
const AFTER_REMOVAL = {
  collections: [page(DECLARED.collection)],
  singles: [banner(DECLARED.single)],
};

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

interface CaseDatabase {
  adapter: DrizzleAdapter;
  close(): Promise<void>;
}

/**
 * A database both boots of a case connect to: a throwaway one on PostgreSQL
 * and MySQL, and one in-memory SQLite connection.
 */
async function openDatabase(dialect: TestDialect): Promise<CaseDatabase> {
  if (dialect === "sqlite") {
    vi.stubEnv("DB_DIALECT", "sqlite");
    _resetEnvCache();
    const adapter = (await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    return { adapter, close: () => adapter.disconnect() };
  }
  const serverUrl = process.env[SERVER_URL_ENV[dialect]];
  if (!serverUrl) throw new Error(`${SERVER_URL_ENV[dialect]} is not set`);
  const name = `nextly_rs_${randomBytes(8).toString("hex")}`;
  vi.stubEnv("DATABASE_URL", serverUrl);
  vi.stubEnv("DB_DIALECT", dialect);
  _resetEnvCache();
  const server = await createAdapter({ type: dialect, url: serverUrl });
  await server.executeQuery(createDatabaseStatement(dialect, name));
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  vi.stubEnv("DATABASE_URL", url.toString());
  _resetEnvCache();
  const adapter = (await createAdapter({
    type: dialect,
    url: url.toString(),
  })) as unknown as DrizzleAdapter;
  return {
    adapter,
    async close() {
      await adapter.disconnect().catch(() => {});
      await server.executeQuery(dropDatabaseStatement(dialect, name));
      await server.disconnect();
    },
  };
}

let current: TestNextly | undefined;

async function boot(
  database: CaseDatabase,
  declared: typeof WITH_REMOVED
): Promise<void> {
  clearServices();
  current = await createTestNextly({
    adapter: database.adapter as never,
    collections: declared.collections,
    singles: declared.singles,
  });
}

type Body = Record<string, unknown>;

async function bodyOf(result: unknown): Promise<Body> {
  return (await (result as Response).json()) as Body;
}

/** What the four reads the admin makes say of one slug of each kind. */
async function marksOf(slugs: { collection: string; single: string }) {
  const adapter = current!.adapter;
  const collections = (
    await bodyOf(
      await dispatchCollections(
        new ServiceContainer(adapter),
        "listCollections",
        { limit: "100" } as never,
        undefined
      )
    )
  ).items as Body[];
  const singles = (
    await bodyOf(await dispatchSingles("listSingles", {} as never, undefined))
  ).items as Body[];
  const collectionSchema = await bodyOf(
    await dispatchCollections(
      new ServiceContainer(adapter),
      "getCollection",
      { collectionName: slugs.collection } as never,
      undefined
    )
  );
  const singleSchema = await bodyOf(
    await dispatchSingles(
      "getSingleSchema",
      { slug: slugs.single } as never,
      undefined
    )
  );
  const pick = (row: Body | undefined) => ({
    removedFromCode: row?.removedFromCode,
    removedFromCodeState: row?.removedFromCodeState,
  });
  return {
    collectionListed: pick(collections.find(c => c.slug === slugs.collection)),
    collectionSchema: pick(collectionSchema),
    singleListed: pick(singles.find(s => s.slug === slugs.single)),
    singleSchema: pick(singleSchema),
    tables: {
      collection: collectionSchema.tableName as string,
      single: singleSchema.tableName as string,
    },
  };
}

/** A table name quoted as the dialect quotes one. */
function quoted(dialect: TestDialect, table: string): string {
  return dialect === "mysql" ? `\`${table}\`` : `"${table}"`;
}

describe.each(getConfiguredTestDialects())(
  "the admin's mark on a collection and a Single removed from code (%s)",
  dialect => {
    let database: CaseDatabase | undefined;
    let migrationsDir = "";
    let tables = { collection: "", single: "" };

    /** Write an app migration whose UP drops both removed entities' main tables. */
    async function writeDrop(file: string): Promise<void> {
      await writeFile(
        join(migrationsDir, file),
        [
          "-- UP",
          `DROP TABLE ${quoted(dialect, tables.collection)};`,
          `DROP TABLE ${quoted(dialect, tables.single)};`,
          "",
          "-- DOWN",
          "SELECT 1;",
          "",
        ].join("\n")
      );
    }

    /** Record an attempt to apply `file` in the ledger, as `nextly migrate` does. */
    async function recordAttempt(
      file: string,
      outcome: "applied" | "failed"
    ): Promise<void> {
      const adapter = database!.adapter;
      await ensureSchemaEventsTable(adapter);
      const repo = new SchemaEventsRepository(adapter.getDrizzle(), dialect);
      const id = await repo.recordStart({
        eventType: "file_apply",
        source: "cli-migrate",
        filename: file,
      });
      if (outcome === "applied") await repo.markApplied(id, {});
      else await repo.markFailed(id, { errorJson: { message: "stopped" } });
    }

    beforeEach(async () => {
      database = await openDatabase(dialect);
      migrationsDir = await mkdtemp(join(tmpdir(), "removed-state-int-"));
      await boot(database, WITH_REMOVED);
      await boot(database, AFTER_REMOVAL);
      setHandlerConfig({ db: { migrationsDir } } as never);
      tables = (await marksOf(REMOVED)).tables;
    }, 120_000);

    afterEach(async () => {
      clearServices();
      current = undefined;
      await database?.close();
      database = undefined;
      await rm(migrationsDir, { recursive: true, force: true });
      vi.unstubAllEnvs();
      _resetEnvCache();
    });

    it("names migrate:create while their tables exist and no migration drops them", async () => {
      const marks = await marksOf(REMOVED);
      const expected = {
        removedFromCode: true,
        removedFromCodeState: { state: "not-dropped" },
      };
      expect(marks.collectionListed).toEqual(expected);
      expect(marks.collectionSchema).toEqual(expected);
      expect(marks.singleListed).toEqual(expected);
      expect(marks.singleSchema).toEqual(expected);

      // A declared collection and Single are read as before, unmarked.
      const kept = await marksOf(DECLARED);
      for (const read of [
        kept.collectionListed,
        kept.collectionSchema,
        kept.singleListed,
        kept.singleSchema,
      ]) {
        expect(read).toEqual({
          removedFromCode: undefined,
          removedFromCodeState: undefined,
        });
      }
    }, 120_000);

    it("names the written drop while it is unapplied and their main tables exist", async () => {
      const file = "20261027_120000_drop_removed.sql";
      await writeDrop(file);

      const marks = await marksOf(REMOVED);
      const expected = {
        removedFromCode: true,
        removedFromCodeState: { state: "drop-pending", migration: file },
      };
      expect(marks.collectionListed).toEqual(expected);
      expect(marks.collectionSchema).toEqual(expected);
      expect(marks.singleListed).toEqual(expected);
      expect(marks.singleSchema).toEqual(expected);
    }, 120_000);

    it("is half-retired once an applied migration dropped their main tables", async () => {
      const file = "20261027_120000_drop_removed.sql";
      await writeDrop(file);
      for (const table of [tables.collection, tables.single]) {
        await database!.adapter.executeQuery(
          `DROP TABLE ${quoted(dialect, table)}`
        );
      }
      await recordAttempt(file, "applied");

      const marks = await marksOf(REMOVED);
      const expected = {
        removedFromCode: true,
        removedFromCodeState: { state: "half-retired" },
      };
      expect(marks.collectionListed).toEqual(expected);
      expect(marks.collectionSchema).toEqual(expected);
      expect(marks.singleListed).toEqual(expected);
      expect(marks.singleSchema).toEqual(expected);
    }, 120_000);

    it("names none of those steps while an attempt to apply the drop stopped", async () => {
      const file = "20261027_120000_drop_removed.sql";
      await writeDrop(file);
      await recordAttempt(file, "failed");

      const marks = await marksOf(REMOVED);
      const expected = {
        removedFromCode: true,
        removedFromCodeState: { state: "other" },
      };
      expect(marks.collectionListed).toEqual(expected);
      expect(marks.singleSchema).toEqual(expected);
    }, 120_000);
  }
);
