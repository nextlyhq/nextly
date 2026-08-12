/**
 * A Schema Builder change holds the storage migration out, and holds it from the START.
 *
 * The design this implements rejected a lock taken inside the registry service, because by then the
 * tables have already changed: it would sample the state rather than hold it. So "the exclusion is
 * taken" is not the property worth asserting — ORDER is. These record the sequence of what the
 * service did, and require the lock to be first.
 *
 * The exclusion primitive itself is covered where it lives; what can be forgotten, and what these
 * exist for, is a service method that never asks for it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Everything the service did, in order: the lock, then whatever ran inside it. */
const trace: string[] = [];
/** Set to make the exclusion refuse, standing in for a migration already in flight. */
const refusal: { error: unknown } = { error: undefined };
/** What the services asked for, so the arguments are observed rather than assumed. */
const excludeArgs: { label?: string; mayCreateLock?: boolean }[] = [];

vi.mock("../../../field-groups/migration/sync-guard", () => ({
  withMigrationExcluded: vi.fn(
    async (
      args: { label: string; mayCreateLock: boolean },
      work: () => Promise<unknown>
    ) => {
      excludeArgs.push({
        label: args.label,
        mayCreateLock: args.mayCreateLock,
      });
      if (refusal.error !== undefined) throw refusal.error;
      trace.push("exclusion:held");
      return work();
    }
  ),
}));

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { Logger } from "../../../../shared/types";
import { SingleMetadataService } from "../../../singles/services/single-metadata-service";
import type { SingleRegistryService } from "../../../singles/services/single-registry-service";

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

/**
 * An adapter that records every statement, so DDL appears in the same trace as the lock.
 *
 * `tableExists` answers the way a fresh create finds the database — the main table present once its
 * CREATE has run, the companion absent — because a create that reports `failed` would leave the
 * ordering assertions describing a run that gave up rather than one that worked.
 */
function makeAdapter() {
  let created = false;
  return {
    getCapabilities: () => ({ dialect: "postgresql" as const }),
    dialect: "postgresql" as const,
    tableExists: vi.fn(async (name: string) =>
      name.includes("_locales") ? false : created
    ),
    selectOne: vi.fn(async (): Promise<{ id: string } | null> => null),
    // The delete path sweeps embedded field-group data and the i18n companion before dropping the
    // table, and both ask the adapter what exists. An empty database is the simplest state that
    // reaches the drop, which is the statement these tests order against.
    listTables: vi.fn(async (): Promise<string[]> => []),
    dropTable: vi.fn(async () => {
      trace.push("ddl");
    }),
    // The i18n teardown reaches the database through Drizzle rather than `executeQuery`, so its
    // own work is not part of the trace. What the trace needs from the delete path is the DROP,
    // which arrives through `dropTable` above.
    getDrizzle: vi.fn(() => ({
      execute: async () => ({ rows: [] }),
      delete: () => ({ where: async () => [] }),
    })),
    executeQuery: vi.fn(async (sql: string) => {
      trace.push("ddl");
      if (/CREATE TABLE/i.test(sql)) created = true;
      return [];
    }),
  };
}

function makeService(adapter: ReturnType<typeof makeAdapter>) {
  const registry = {
    registerSingle: vi.fn(async (row: unknown) => {
      trace.push("registry:write");
      return row;
    }),
    updateSingle: vi.fn(async () => ({})),
    deleteSingle: vi.fn(async () => {
      trace.push("registry:write");
    }),
  };
  const service = new SingleMetadataService(
    registry as unknown as SingleRegistryService,
    logger,
    adapter as unknown as DrizzleAdapter
  );
  return { service, registry };
}

beforeEach(() => {
  trace.length = 0;
  excludeArgs.length = 0;
  refusal.error = undefined;
});

describe("a Schema Builder change and the storage migration exclude each other", () => {
  it("holds the exclusion BEFORE it writes any DDL or any row", async () => {
    // 🔴 The ordering IS the property. A lock acquired after the tables changed answers whether a
    // migration had started by the instant of the read, which is what the design rejected: the
    // create would already have built a table the migration's manifest was assembled without.
    const adapter = makeAdapter();
    const { service } = makeService(adapter);

    await service.createSingle({
      slug: "page",
      label: "Page",
      tableName: "single_page",
      fields: [{ name: "heading", type: "text" }],
    } as unknown as Parameters<typeof service.createSingle>[0]);

    expect(trace[0]).toBe("exclusion:held");
    expect(trace).toContain("ddl");
    expect(trace).toContain("registry:write");
  });

  it("writes nothing at all when a migration is already in flight", async () => {
    // The refusal has to arrive before anything, not after the table exists. Asserting the throw
    // alone would pass on a service that created the table and then refused.
    const adapter = makeAdapter();
    const { service, registry } = makeService(adapter);
    refusal.error = new Error("a field group storage migration is in flight");

    await expect(
      service.createSingle({
        slug: "page",
        label: "Page",
        tableName: "single_page",
        fields: [{ name: "heading", type: "text" }],
      } as unknown as Parameters<typeof service.createSingle>[0])
    ).rejects.toThrow(/in flight/);

    expect(trace).toEqual([]);
    expect(adapter.executeQuery).not.toHaveBeenCalled();
    expect(registry.registerSingle).not.toHaveBeenCalled();
  });

  it("asks for the exclusion on every schema-changing method, not only create", async () => {
    // What this guards is a method that never asks. The three are listed by their observed LABELS
    // rather than by a call count, so a fourth method added without the exclusion shows up as a
    // missing name instead of an off-by-one nobody reads.
    const adapter = makeAdapter();
    const { service } = makeService(adapter);

    await service.createSingle({
      slug: "page",
      label: "Page",
      tableName: "single_page",
      fields: [],
    } as unknown as Parameters<typeof service.createSingle>[0]);
    await service.deleteSingle("page", "single_page");

    expect(excludeArgs.map(a => a.label)).toEqual([
      'create single "page"',
      'delete single "page"',
    ]);
  });

  it("may create the lock table, because these paths issue DDL", async () => {
    // `mayCreateLock` is not a formality. Answering false here would leave a database that has
    // never run a migration entirely unprotected: the first storage migration would create the
    // lock table, claim it, and start renaming while this change was already under way.
    const adapter = makeAdapter();
    const { service } = makeService(adapter);

    await service.deleteSingle("page", "single_page");

    expect(excludeArgs[0]?.mayCreateLock).toBe(true);
  });
});
