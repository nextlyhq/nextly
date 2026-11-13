/**
 * `db:sync --remove-orphaned` drops an orphaned field group's or collection's table through the
 * busy-table tries: a table another session keeps busy is tried again within the bounds, and then
 * the sync stops with `NEXTLY_TABLE_BUSY` naming the table, instead of logging one more failed
 * deletion and moving on. The table is dropped before the registry entry is deleted, so an orphan
 * whose drop stopped is still in the registry, and the next sync finds it again.
 *
 * The database is a SQLite stand-in whose drop of the orphan's table reports the busy timeout every
 * time it is sent. The exclusion and the dependent-data teardown are faked; they are not what is
 * judged here. The case pauses for real between tries (about a second).
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../domains/schema/services/schema-change-exclusion", () => ({
  withSchemaChangeExcluded: async (
    _args: unknown,
    work: () => Promise<unknown>
  ) => work(),
}));
vi.mock(
  "../../../domains/field-groups/services/teardown-entity-field-group-data",
  () => ({ teardownEntityComponentData: async () => undefined })
);
vi.mock("../../../domains/i18n/migration/teardown-entity-i18n", () => ({
  teardownEntityI18n: async () => undefined,
}));
vi.mock("../../../domains/field-groups/storage/resolve-storage-names", () => ({
  resolveFieldGroupRegistryName: async () => "dynamic_field_groups",
  resolveTypeColumns: async () => new Map(),
}));

import { CollectionSyncService } from "../../../domains/collections/services/collection-sync-service";
import { handleRemovedComponents } from "../dev-build";

const DROP = 'DROP TABLE IF EXISTS "comp_hero"';
const DROP_POSTS = 'DROP TABLE IF EXISTS "dc_posts"';
/** Each registry delete, by what it was sent through. */
const registryDeletes: string[] = [];

/** SQLite's busy timeout running out, as its driver reports it. */
function sqliteBusy(): Error {
  return Object.assign(new Error("database is locked"), {
    code: "SQLITE_BUSY",
  });
}

/** Every statement sent but the busy-timeout pragmas, in order. */
const sent: string[] = [];

const adapter = {
  getCapabilities: () => ({ dialect: "sqlite" as const }),
  delete: async () => {
    registryDeletes.push("delete");
  },
  transaction: async () => {
    registryDeletes.push("transaction");
    return { expire: [] };
  },
  tableExists: async () => false,
  executeQuery: (statement: string): Promise<unknown[]> => {
    if (statement === "PRAGMA busy_timeout") {
      return Promise.resolve([{ timeout: 0 }]);
    }
    if (statement.startsWith("PRAGMA busy_timeout")) {
      return Promise.resolve([]);
    }
    sent.push(statement);
    return statement === DROP || statement === DROP_POSTS
      ? Promise.reject(sqliteBusy())
      : Promise.resolve([]);
  },
  // The catalog's triggers, read only where a waiting statement is a row change: none here.
  queryStatement: () => Promise.resolve([]),
  // SQLite runs every statement on its one connection, so no session is opened.
  withSession: () => Promise.reject(new Error("no session on SQLite")),
} as unknown as DrizzleAdapter;

const warnings: string[] = [];
const logger = {
  info: () => {},
  warn: (line: string) => {
    warnings.push(line);
  },
  error: () => {},
  debug: () => {},
  success: () => {},
  newline: () => {},
} as unknown as Parameters<typeof handleRemovedComponents>[2];

beforeEach(() => {
  sent.length = 0;
  registryDeletes.length = 0;
  warnings.length = 0;
  // One try of a second, three in all: tries at 0 and about 1 second, then a stop.
  vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "1");
  vi.stubEnv("NEXTLY_LOCK_TIMEOUT_TOTAL", "3");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dropping an orphaned field group's busy table", () => {
  it("tries the drop again, then stops the sync with NEXTLY_TABLE_BUSY naming the table", async () => {
    const stopped = await handleRemovedComponents(
      [{ slug: "hero", tableName: "comp_hero" }],
      adapter,
      logger
    ).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(stopped).toMatchObject({
      code: "NEXTLY_TABLE_BUSY",
      logContext: {
        stop: {
          change:
            'the removal of orphaned field groups: the drop of table "comp_hero"',
          ended: { table: "comp_hero" },
          tries: 2,
          appliedBefore: [],
          outcome: { kind: "nothing-changed" },
        },
      },
    });
    // Sent once a try, and each try after the first told on the logger's warning.
    expect(sent.filter(statement => statement === DROP)).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('table "comp_hero" is busy');
    // The registry entry stays, so the next sync finds the orphan again.
    expect(registryDeletes).toEqual([]);
  });
});

describe("dropping an orphaned collection's busy table", () => {
  it("stops with NEXTLY_TABLE_BUSY and keeps the registry entry, so the next sync finds it", async () => {
    const service = new CollectionSyncService(adapter, {
      info: () => {},
      warn: (line: string) => {
        warnings.push(line);
      },
      error: () => {},
      debug: () => {},
    } as never);
    const removeOrphans = (
      service as unknown as {
        handleRemovedCollections(
          removed: Array<{ slug: string; tableName: string }>,
          action: "delete",
          warnings: string[]
        ): Promise<Set<string>>;
      }
    ).handleRemovedCollections.bind(service);

    const stopped = await removeOrphans(
      [{ slug: "posts", tableName: "dc_posts" }],
      "delete",
      []
    ).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(stopped).toMatchObject({
      code: "NEXTLY_TABLE_BUSY",
      logContext: {
        stop: {
          ended: { table: "dc_posts" },
          appliedBefore: [],
          outcome: { kind: "nothing-changed" },
        },
      },
    });
    expect(registryDeletes).toEqual([]);
  });
});
