/**
 * The exclusion a Schema Builder change asks for, composed with the real lock rather than a stand-in.
 *
 * Its sibling `schema-change-exclusion.test.ts` replaces `withMigrationExcluded` so it can assert
 * ORDER — that the exclusion is taken before any DDL or any row. That substitution is what makes
 * those assertions readable, and it is also what they cannot check: a service could ask for an
 * exclusion that never claims anything and every one of them would still pass.
 *
 * So these run the real primitive against an in-memory lock. What they establish is the part the
 * mocked suite has to assume — that asking actually claims the row, that the claim is held while the
 * work runs and given back afterwards, and that a run already holding it turns the schema change
 * away before it has touched a table.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import type { Logger } from "../../../../shared/types";
import {
  hashManifest,
  MIGRATION_TARGET,
  type ManifestEntry,
} from "../../../field-groups/migration/manifest";
import { MIGRATION_MARKER_VERSION } from "../../../field-groups/migration/state";
import {
  isMigrationLockStatement,
  withMigrationLockSurface,
  type MigrationLockSurfaceOptions,
} from "../../../field-groups/migration/__tests__/helpers/migration-lock-double";
import { FieldGroupMetadataService } from "../../../field-groups/services/field-group-metadata-service";
import type { FieldGroupRegistryService } from "../../../field-groups/services/field-group-registry-service";
import { SingleMetadataService } from "../../../singles/services/single-metadata-service";
import type { SingleRegistryService } from "../../../singles/services/single-registry-service";

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

/** Every statement the create issued, in order, so the lock's own DDL can be told from the table's. */
const executed: string[] = [];

/**
 * `tableExists` answers the way a fresh create finds the database — the main table present once its
 * CREATE has run, the companion absent — because a create that reported `failed` would leave these
 * describing a run that gave up rather than one that worked.
 *
 * `nextly_meta` answers present, so the marker read inside the lock is genuinely performed rather
 * than skipped by a database that has no meta table at all.
 */
function makeAdapter(options: MigrationLockSurfaceOptions = {}) {
  let created = false;
  return withMigrationLockSurface(
    {
      dialect: "postgresql" as const,
      getCapabilities: () => ({ dialect: "postgresql" as const }),
      tableExists: vi.fn(async (name: string) => {
        if (name === "nextly_meta") return true;
        return name.includes("_locales") ? false : created;
      }),
      selectOne: vi.fn(async (): Promise<{ id: string } | null> => null),
      executeQuery: vi.fn(async (sql: string) => {
        executed.push(sql);
        // The lock's DDL is a `CREATE TABLE` too, and it runs first. Letting it set this flag would
        // report the single's table as present before anything had built it.
        if (!isMigrationLockStatement(sql) && /CREATE TABLE/i.test(sql)) {
          created = true;
        }
        return [];
      }),
    },
    options
  );
}

/**
 * The smallest plan a marker can carry: the registry rename every run performs.
 *
 * Spelled from the catalog and the target rather than written out, so it stays a VALID plan if
 * either name moves. A marker whose manifest does not rename the registry exactly once is rejected
 * before its status is read, and that rejection carries the same error code as the refusal this
 * fixture exists to reach.
 */
const IN_FLIGHT_PLAN: ManifestEntry[] = [
  {
    kind: "registry",
    from: STORAGE_FORMAT.registryTable,
    to: MIGRATION_TARGET.registryTable,
  },
];

const INPUT = {
  slug: "page",
  label: "Page",
  tableName: "single_page",
  fields: [{ name: "heading", type: "text" }],
};

function makeService(
  adapter: ReturnType<typeof makeAdapter>,
  onRegister?: () => void
) {
  const registry = {
    registerSingle: vi.fn(async (row: unknown) => {
      onRegister?.();
      return row;
    }),
    updateSingle: vi.fn(async () => ({})),
    deleteSingle: vi.fn(async () => {}),
  };
  const service = new SingleMetadataService(
    registry as unknown as SingleRegistryService,
    logger,
    adapter as unknown as DrizzleAdapter
  );
  return { service, registry };
}

const createSingle = (service: SingleMetadataService) =>
  service.createSingle(
    INPUT as unknown as Parameters<typeof service.createSingle>[0]
  );

beforeEach(() => {
  executed.length = 0;
});

describe("a schema change and the storage migration contend for one row", () => {
  it("holds the lock while the work runs, and gives it back", async () => {
    // Sampled from INSIDE the work rather than after it. A claim taken and released around nothing
    // would leave the same empty row behind as one that never claimed at all, so the only moment
    // that separates the two is while the create is still writing.
    const adapter = makeAdapter();
    let ownerDuringWork: string | null = null;
    const { service } = makeService(adapter, () => {
      ownerDuringWork = adapter.migrationLock.ownerNow();
    });

    await createSingle(service);

    expect(ownerDuringWork).toMatch(/^create single "page"#/);
    expect(adapter.migrationLock.ownerNow()).toBeNull();
  });

  it("creates the lock table on a database that has never run a migration", async () => {
    // `mayCreateLock` is what makes this path safe on a fresh database: without the table, a first
    // storage migration would create it, claim it, and start renaming while this change was already
    // under way. The DDL is the observable form of that decision.
    const adapter = makeAdapter({ lockTableExists: false });
    const { service } = makeService(adapter);

    await createSingle(service);

    expect(executed.filter(isMigrationLockStatement).length).toBeGreaterThan(0);
  });

  it("refuses, and builds nothing, while another run holds the lock", async () => {
    const adapter = makeAdapter({ heldBy: "storage migration#other-run" });
    const { service, registry } = makeService(adapter);

    await expect(createSingle(service)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });

    // The refusal has to arrive before the table, not after it. Asserting the throw alone would
    // pass on a create that built its table and then discovered the contention.
    expect(executed.filter(sql => !isMigrationLockStatement(sql))).toEqual([]);
    expect(registry.registerSingle).not.toHaveBeenCalled();
  });

  it("refuses, and builds nothing, while a migration marker is in flight", async () => {
    // A free lock is not sufficient. A run that died mid-migration leaves the marker behind and the
    // row unclaimed, and the storage it half-renamed is exactly what this change must not touch.
    //
    // 🔴 `version` and `manifestHash` are DERIVED, not written out. A hand-written marker is
    // rejected as unreadable before its status is ever consulted, and the refusal that produces is
    // a different one wearing the same error code — so the test passes while exercising nothing it
    // claims to. Deriving both means a future marker-format change moves this fixture with it
    // instead of silently turning the test back into a version check.
    const adapter = makeAdapter({
      heldBy: null,
      marker: {
        version: MIGRATION_MARKER_VERSION,
        status: "migrating",
        direction: "up",
        migrationId: "run-1",
        step: 1,
        registryHash: "r",
        manifestHash: hashManifest(IN_FLIGHT_PLAN),
        appliedManifest: IN_FLIGHT_PLAN,
      },
    });
    const { service, registry } = makeService(adapter);

    const error = await createSingle(service).catch(
      (caught: unknown) => caught
    );

    // 🔴 The REASON is asserted, not just the code. An unreadable marker refuses with the same
    // `SERVICE_UNAVAILABLE`, so a fixture the parser rejects would satisfy a code-only assertion
    // while never reaching the in-flight check this test exists for — which is exactly what it did
    // before the fixture was derived above.
    expect(error).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      logContext: { reason: "field group storage migration is in flight" },
    });

    expect(executed.filter(sql => !isMigrationLockStatement(sql))).toEqual([]);
    expect(registry.registerSingle).not.toHaveBeenCalled();
    // Released on the way out, so a refusal does not strand the row it took to make the decision.
    expect(adapter.migrationLock.ownerNow()).toBeNull();
  });
});

/**
 * The same properties for the other service that was wrapped.
 *
 * Kept as its own block rather than folded into the singles cases, because "the singles wrapper
 * works" says nothing about the field-group one — they are separate call sites and either could be
 * removed with every assertion above still passing.
 */
describe("a field-group create contends for the same row", () => {
  function makeFieldGroupService(adapter: ReturnType<typeof makeAdapter>) {
    const registry = {
      // Answers "no field group owns that table" so the create reaches the DDL path.
      getAllComponents: vi.fn().mockResolvedValue([]),
      registerComponent: vi.fn(async (row: unknown) => row),
    };
    const service = new FieldGroupMetadataService(
      registry as unknown as FieldGroupRegistryService,
      logger,
      adapter as unknown as DrizzleAdapter
    );
    return { service, registry };
  }

  const FIELD_GROUP_INPUT = {
    slug: "hero",
    label: "Hero",
    tableName: "comp_hero",
    fields: [{ name: "heading", type: "text" }],
    source: "ui",
    locked: false,
    schemaHash: "hash-for-the-fields-above",
  };

  const createFieldGroup = (service: FieldGroupMetadataService) =>
    service.createFieldGroup(
      FIELD_GROUP_INPUT as unknown as Parameters<
        typeof service.createFieldGroup
      >[0]
    );

  it("holds the lock while the work runs", async () => {
    const adapter = makeAdapter();
    let ownerDuringWork: string | null = null;
    const { service, registry } = makeFieldGroupService(adapter);
    registry.registerComponent.mockImplementation(async (row: unknown) => {
      ownerDuringWork = adapter.migrationLock.ownerNow();
      return row;
    });

    await createFieldGroup(service);

    expect(ownerDuringWork).toMatch(/^create field group "hero"#/);
    expect(adapter.migrationLock.ownerNow()).toBeNull();
  });

  it("refuses, and builds nothing, while another run holds the lock", async () => {
    const adapter = makeAdapter({ heldBy: "storage migration#other-run" });
    const { service, registry } = makeFieldGroupService(adapter);

    await expect(createFieldGroup(service)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });

    expect(executed.filter(sql => !isMigrationLockStatement(sql))).toEqual([]);
    expect(registry.registerComponent).not.toHaveBeenCalled();
  });

  it("builds no table and writes no row when the input itself is impossible", async () => {
    // What an impossible input must not leave behind is a TABLE and a ROW. The lock's own table is
    // a deliberate exception and is asserted separately below, because planning has to happen
    // inside the exclusion: rendering DDL reads the process-global field-type registry, which an
    // HMR reload replaces from inside this same lock.
    const adapter = makeAdapter({ lockTableExists: false });
    const { service, registry } = makeFieldGroupService(adapter);

    await expect(
      service.createFieldGroup({
        ...FIELD_GROUP_INPUT,
        tableName: `comp_${"x".repeat(80)}`,
      } as unknown as Parameters<typeof service.createFieldGroup>[0])
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(executed.filter(sql => !isMigrationLockStatement(sql))).toEqual([]);
    expect(registry.registerComponent).not.toHaveBeenCalled();
  });

  it("leaves behind only the lock's own table when it refuses an impossible input", async () => {
    // The cost of planning inside the exclusion, pinned rather than described. If this ever starts
    // failing because NOTHING was written, planning has moved back outside the lock and the plugin
    // field-type race is open again.
    const adapter = makeAdapter({ lockTableExists: false });
    const { service } = makeFieldGroupService(adapter);

    await expect(
      service.createFieldGroup({
        ...FIELD_GROUP_INPUT,
        tableName: `comp_${"x".repeat(80)}`,
      } as unknown as Parameters<typeof service.createFieldGroup>[0])
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(executed.every(isMigrationLockStatement)).toBe(true);
    expect(executed.length).toBeGreaterThan(0);
  });
});
