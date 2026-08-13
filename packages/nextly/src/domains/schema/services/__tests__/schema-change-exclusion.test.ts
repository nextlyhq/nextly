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
const excludeArgs: {
  label?: string;
  mayCreateLock?: boolean;
  releaseOnInterrupt?: boolean;
}[] = [];

vi.mock("../../../field-groups/migration/sync-guard", () => ({
  withMigrationExcluded: vi.fn(
    async (
      args: {
        label: string;
        mayCreateLock: boolean;
        releaseOnInterrupt: boolean;
      },
      work: () => Promise<unknown>
    ) => {
      excludeArgs.push({
        label: args.label,
        mayCreateLock: args.mayCreateLock,
        releaseOnInterrupt: args.releaseOnInterrupt,
      });
      if (refusal.error !== undefined) throw refusal.error;
      trace.push("exclusion:held");
      return work();
    }
  ),
}));

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../../errors/nextly-error";
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
function makeAdapter(options: { mainTableExists?: boolean } = {}) {
  let created = options.mainTableExists === true;
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
    // Read INSIDE the exclusion, so an update plans from the record as it is once the lock is held
    // rather than as the caller found it. Answers the same shape the caller passed in, which is the
    // uncontended case; the contended one is covered where the lock itself is modelled.
    getSingleBySlug: vi.fn(async (slug: string) => ({
      slug,
      tableName: "single_page",
      fields: [],
      locked: false,
    })),
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
    // The error production actually raises, not a bare stand-in: a test that asserts a refusal
    // propagates should propagate the shape callers will meet.
    refusal.error = NextlyError.serviceUnavailable({
      logMessage: "a field group storage migration is in flight",
      logContext: { reason: "field group storage migration is in flight" },
    });

    await expect(
      service.createSingle({
        slug: "page",
        label: "Page",
        tableName: "single_page",
        fields: [{ name: "heading", type: "text" }],
      } as unknown as Parameters<typeof service.createSingle>[0])
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });

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
    // A flags-only save: `fields` absent means the plan renders no DDL, which is the update shape
    // most likely to be thought too small to need the exclusion.
    await service.updateSingleSchema({
      slug: "page",
      existing: { slug: "page", tableName: "single_page", fields: [] },
      updateData: { label: "Page renamed" },
      isLocalized: false,
      wasLocalized: false,
      hasStatus: false,
      wasStatus: false,
      statusRequested: false,
    } as unknown as Parameters<typeof service.updateSingleSchema>[0]);

    expect(excludeArgs.map(a => a.label)).toEqual([
      'create single "page"',
      'delete single "page"',
      'update single schema "page"',
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

  it("claims DDL rights only when the save can actually change schema", async () => {
    // Taking the exclusion with `mayCreateLock` runs `CREATE TABLE IF NOT EXISTS` for the lock's own
    // table. A deployment that deliberately gives the application role DML but not DDL would then
    // start refusing metadata edits — a label change, a webhook toggle — that worked before. Both
    // directions are asserted: a false that should be true would leave a real schema change with no
    // lock table to claim, which is the worse error of the two.
    const adapter = makeAdapter();
    const { service } = makeService(adapter);
    const base = {
      slug: "page",
      existing: { slug: "page", tableName: "single_page", fields: [] },
      updateData: { label: "Page renamed" },
      isLocalized: false,
      wasLocalized: false,
      hasStatus: false,
      wasStatus: false,
      statusRequested: false,
    };

    await service.updateSingleSchema(
      base as unknown as Parameters<typeof service.updateSingleSchema>[0]
    );
    await service.updateSingleSchema({
      ...base,
      fields: [{ name: "heading", type: "text" }],
    } as unknown as Parameters<typeof service.updateSingleSchema>[0]);

    expect(excludeArgs.map(a => a.mayCreateLock)).toEqual([false, true]);
  });

  it("plans from the record as it is INSIDE the exclusion, not as the caller found it", async () => {
    // 🔴 The caller reads the Single before this lock exists, and a storage migration completing in
    // between rewrites `dynamic_singles.fields`. Planning from the caller's copy would derive the
    // change from definitions the database no longer holds, and the registry write would put the
    // old spelling back under a settled marker.
    //
    // The two records are made to DISAGREE so the assertion can tell which one was used: the
    // caller's copy already lists `heading`, the live one does not. Planning from the caller's copy
    // sees no new field and emits nothing; planning from the live record has to add the column.
    // The table has to already EXIST, or the plan is a whole-table CREATE derived from the
    // requested fields and both records produce the same statements — a fixture that never reaches
    // the comparison it is written to make.
    const adapter = makeAdapter({ mainTableExists: true });
    const { service, registry } = makeService(adapter);
    registry.getSingleBySlug.mockResolvedValue({
      slug: "page",
      tableName: "single_page",
      fields: [],
      locked: false,
    });

    await service.updateSingleSchema({
      slug: "page",
      existing: {
        slug: "page",
        tableName: "single_page",
        fields: [{ name: "heading", type: "text" }],
      },
      updateData: {},
      fields: [{ name: "heading", type: "text" }],
      isLocalized: false,
      wasLocalized: false,
      hasStatus: false,
      wasStatus: false,
      statusRequested: false,
    } as unknown as Parameters<typeof service.updateSingleSchema>[0]);

    const statements = adapter.executeQuery.mock.calls.map(([sql]) => sql);
    expect(statements.join("\n")).toMatch(/ADD COLUMN[^\n]*heading/i);
  });

  it("keeps the claim through an interrupt, because the work is not idempotent", async () => {
    // The signal does not stop the work. A session that released here would hand the row to a
    // storage migration while this change was still between its DDL and its registry write, which
    // is the overlap the exclusion exists to prevent — so a schema change opts OUT of the release a
    // schema SYNC opts into. Observed from the arguments the service actually passes rather than
    // restated here, so rewording the option cannot leave this asserting a value nobody reads.
    const adapter = makeAdapter();
    const { service } = makeService(adapter);

    await service.deleteSingle("page", "single_page");

    expect(excludeArgs[0]?.releaseOnInterrupt).toBe(false);
  });
});
