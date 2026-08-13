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

/** The flags the companion is built from, captured where the service actually passes them. */
const companionCalls: Record<string, unknown>[] = [];

vi.mock("../../../singles/services/reconcile-single-companion", () => ({
  reconcileSingleCompanion: vi.fn(async (args: Record<string, unknown>) => {
    companionCalls.push(args);
  }),
}));

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

/**
 * The registry row shape these doubles answer with.
 *
 * Named, with the fields the service reads OPTIONAL, so a test can override just the property it is
 * about. Inferring it from the default object instead pins the exact key set, and every override
 * then has to restate keys it does not care about — which is how a fixture drifts away from the
 * case it is describing.
 */
interface SingleRowDouble {
  slug: string;
  tableName: string;
  fields?: unknown[];
  locked?: boolean;
  schemaHash?: string;
  status?: boolean;
  localized?: boolean;
}

function makeService(adapter: ReturnType<typeof makeAdapter>) {
  const registry = {
    // Read INSIDE the exclusion, so an update plans from the record as it is once the lock is held
    // rather than as the caller found it. Answers the same shape the caller passed in, which is the
    // uncontended case; the contended one is covered where the lock itself is modelled.
    // Read INSIDE the exclusion by the create path, which re-asserts that no other Single has
    // claimed this table while the request waited. Empty is the uncontended answer.
    getAllSingles: vi.fn(
      async (): Promise<{ slug: string; tableName: string }[]> => []
    ),
    getSingleBySlug: vi.fn(
      async (slug: string): Promise<SingleRowDouble> => ({
        slug,
        tableName: "single_page",
        fields: [] as unknown[],
        locked: false,
        // Present in the default shape because the service reads them. Omitting a field here and
        // supplying it per test would type the double without it and reject those overrides.
        schemaHash: "unchanged",
        status: false,
        localized: false,
      })
    ),
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
  companionCalls.length = 0;
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

  it("refuses when the Single became locked while it waited", async () => {
    // Replaces an earlier test that asserted planning uses the refreshed record. That property can
    // no longer be OBSERVED: a refreshed record whose definitions differ is now refused outright,
    // and one whose definitions match plans identically either way, so nothing distinguishes the
    // two. What the refresh still decides on its own is this — a Single that became code-first
    // while the request waited must not receive a UI edit, because the config is about to
    // contradict the row.
    const adapter = makeAdapter({ mainTableExists: true });
    const { service, registry } = makeService(adapter);
    registry.getSingleBySlug.mockResolvedValue({
      slug: "page",
      tableName: "single_page",
      fields: [],
      locked: true,
      schemaHash: "unchanged",
    });

    await expect(
      service.updateSingleSchema({
        slug: "page",
        existing: {
          slug: "page",
          tableName: "single_page",
          fields: [],
          locked: false,
          schemaHash: "unchanged",
        },
        updateData: { label: "Page renamed" },
        isLocalized: false,
        wasLocalized: false,
        hasStatus: false,
        wasStatus: false,
        statusRequested: false,
      } as unknown as Parameters<typeof service.updateSingleSchema>[0])
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(registry.updateSingle).not.toHaveBeenCalled();
  });

  it("takes the PRIOR flags from the refreshed record, keeping only what the request set", async () => {
    // 🔴 Codex's scenario exactly. One save enabled Draft/Published and committed. This save was
    // composed before that, so it carries `wasStatus: false` and a `hasStatus: false` the CALLER
    // filled in because the request said nothing about status — it asks only for localization.
    // Planning from those builds the companion WITHOUT `_status` while the row says it has one.
    //
    // Observed at the seam the service actually passes the flags to, rather than through emitted
    // SQL: two earlier attempts asserted on `executeQuery`, and this path issues none at all, so
    // the break-control passed and the tests proved nothing. The companion is where these flags
    // are consumed, so that is where they are read.
    const adapter = makeAdapter({ mainTableExists: true });
    const { service, registry } = makeService(adapter);
    registry.getSingleBySlug.mockResolvedValue({
      slug: "page",
      tableName: "single_page",
      fields: [],
      locked: false,
      schemaHash: "unchanged",
      status: true,
      localized: false,
    });

    await service.updateSingleSchema({
      slug: "page",
      existing: {
        slug: "page",
        tableName: "single_page",
        fields: [],
        schemaHash: "unchanged",
        status: false,
        localized: false,
      },
      updateData: { localized: true },
      isLocalized: true,
      wasLocalized: false,
      localizedRequested: true,
      hasStatus: false,
      wasStatus: false,
      statusRequested: false,
      fields: [{ name: "heading", type: "text" }],
    } as unknown as Parameters<typeof service.updateSingleSchema>[0]);

    expect(companionCalls).toHaveLength(1);
    expect(companionCalls[0]).toMatchObject({
      // From the refreshed record: this Single HAS status, whatever the caller last saw.
      status: true,
      wasStatus: true,
      // From the request, which did ask for this one.
      localized: true,
    });
  });

  it("refuses to CREATE onto a table claimed while it waited", async () => {
    // 🔴 The registry insert at the end already rejects the duplicate row, which is why this looks
    // unnecessary and is not. Before that insert the create has already run `CREATE TABLE IF NOT
    // EXISTS` against the table the config now owns and REBOUND THE RUNTIME SCHEMA to this
    // request's fields — and the runtime stays rebound until the process restarts. The insert makes
    // the row safe; it does not make the process safe.
    const adapter = makeAdapter();
    const { service, registry } = makeService(adapter);
    registry.getAllSingles.mockResolvedValue([
      { slug: "page_from_code", tableName: "single_page" },
    ]);

    await expect(
      service.createSingle({
        slug: "page",
        label: "Page",
        tableName: "single_page",
        fields: [{ name: "heading", type: "text" }],
      } as unknown as Parameters<typeof service.createSingle>[0])
    ).rejects.toMatchObject({ code: "DUPLICATE" });

    expect(trace).toEqual(["exclusion:held"]);
    expect(registry.registerSingle).not.toHaveBeenCalled();
  });

  it("refuses to DELETE a Single that became code-first while it waited", async () => {
    // 🔴 The most dangerous of the stale-input cases, because the delete path calls
    // `deleteSingle(..., { force: true })` — which walks past the registry's own protection for
    // code-owned records. An HMR reload turning an unlocked UI Single into a locked code-first one
    // between the caller's check and this claim would otherwise drop a table the config owns.
    const adapter = makeAdapter();
    const { service, registry } = makeService(adapter);
    registry.getSingleBySlug.mockResolvedValue({
      slug: "page",
      tableName: "single_page",
      fields: [],
      locked: true,
      schemaHash: "unchanged",
    });

    await expect(
      service.deleteSingle("page", "single_page")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(registry.deleteSingle).not.toHaveBeenCalled();
    expect(adapter.dropTable).not.toHaveBeenCalled();
  });

  it("refuses the WRITE when the stored schema moved while it waited", async () => {
    // 🔴 Refreshing the record fixes what the update PLANS from and not what it WRITES. The caller
    // composes `updateData.fields` from the definitions it read, and those go back verbatim — so a
    // storage migration that renamed the field-group vocabulary in between would be undone by this
    // save. Exercised through `updateData` on purpose: the sibling test above passes `updateData:
    // {}` and therefore never touches the writeback path this guards.
    const adapter = makeAdapter({ mainTableExists: true });
    const { service, registry } = makeService(adapter);
    // Models what a storage migration ACTUALLY does: it rewrites the stored field definitions into
    // the new vocabulary and leaves `schema_hash` untouched, because its registry step projects only
    // id / fields / config_path. A fixture that moved the hash instead would be testing a state the
    // migration never produces — which is what the first version of this test did.
    registry.getSingleBySlug.mockResolvedValue({
      slug: "page",
      tableName: "single_page",
      fields: [{ name: "hero", type: "fieldGroup" }],
      locked: false,
      schemaHash: "unchanged",
    });

    await expect(
      service.updateSingleSchema({
        slug: "page",
        existing: {
          slug: "page",
          tableName: "single_page",
          // The caller's copy still carries the pre-migration spelling.
          fields: [{ name: "hero", type: "component" }],
          schemaHash: "unchanged",
        },
        updateData: { fields: [{ name: "hero", type: "component" }] },
        fields: [{ name: "hero", type: "component" }],
        isLocalized: false,
        wasLocalized: false,
        hasStatus: false,
        wasStatus: false,
        statusRequested: false,
      } as unknown as Parameters<typeof service.updateSingleSchema>[0])
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Nothing written: the stale payload must not reach the registry at all.
    expect(registry.updateSingle).not.toHaveBeenCalled();
  });

  it("still allows an update when the stored schema did not move", async () => {
    // The positive control. Without it, a check that refused EVERY update would satisfy the test
    // above, and the refusal would look like coverage while breaking ordinary saves.
    const adapter = makeAdapter({ mainTableExists: true });
    const { service, registry } = makeService(adapter);
    registry.getSingleBySlug.mockResolvedValue({
      slug: "page",
      tableName: "single_page",
      fields: [],
      locked: false,
      schemaHash: "unchanged",
    });

    await service.updateSingleSchema({
      slug: "page",
      existing: {
        slug: "page",
        tableName: "single_page",
        fields: [],
        schemaHash: "unchanged",
      },
      updateData: { label: "Page renamed" },
      isLocalized: false,
      wasLocalized: false,
      hasStatus: false,
      wasStatus: false,
      statusRequested: false,
    } as unknown as Parameters<typeof service.updateSingleSchema>[0]);

    expect(registry.updateSingle).toHaveBeenCalled();
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
