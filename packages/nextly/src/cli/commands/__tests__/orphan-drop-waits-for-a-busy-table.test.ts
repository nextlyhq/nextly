/**
 * `db:sync --remove-orphaned` drops an orphaned field group's table through the busy-table tries:
 * a table another session keeps busy is tried again within the bounds, and then the sync stops with
 * `NEXTLY_TABLE_BUSY` naming the table, instead of logging one more failed deletion and moving on.
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

import { handleRemovedComponents } from "../dev-build";

const DROP = 'DROP TABLE IF EXISTS "comp_hero"';

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
  delete: async () => undefined,
  executeQuery: (statement: string): Promise<unknown[]> => {
    if (statement === "PRAGMA busy_timeout") {
      return Promise.resolve([{ timeout: 0 }]);
    }
    if (statement.startsWith("PRAGMA busy_timeout")) {
      return Promise.resolve([]);
    }
    sent.push(statement);
    return statement === DROP
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
          appliedBefore: [
            'the removal of orphaned field groups: the registry entry of field group "hero"',
          ],
          outcome: { kind: "nothing-changed" },
        },
      },
    });
    // Sent once a try, and each try after the first told on the logger's warning.
    expect(sent.filter(statement => statement === DROP)).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('table "comp_hero" is busy');
  });
});
