/**
 * What a field-group create REQUEST turns into on the way to the database, recorded from the
 * request in.
 *
 * The generators' own output is pinned elsewhere, per set of options. That records what each
 * generator RENDERS and cannot record what a caller PASSES: a handler that stops forwarding
 * `localized` or the adapter's dialect still reaches every one of those assertions with the options
 * spelled out correctly, and they all still pass.
 *
 * So these drive the dispatcher with a request-shaped payload and assert on the SQL the adapter is
 * actually handed. That is the half no snapshot can cover, and it is the half a change which moves
 * this code somewhere else can silently break.
 *
 * Deliberately a separate file from `component-dispatcher-shapes.test.ts`, which defeats both halves
 * on purpose: it reports no adapter from DI and a container that has none, because it is testing
 * response envelopes rather than DDL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../helpers/di", () => ({
  getComponentRegistryFromDI: vi.fn(),
  getFieldGroupMetadataServiceFromDI: vi.fn(),
  getAdapterFromDI: vi.fn(),
  // The apply route takes the schema-change exclusion, which reports a skipped lock through this.
  // Omitted, the mocked module supplies no such export and the handler throws before it starts.
  getLoggerFromDI: vi.fn(() => undefined),
  // Reached by the companion reconciliation a localized create runs. Omitted, calling it throws and
  // the handler catches that as a companion-provisioning failure — so the assertions below would
  // describe a FAILED migration while passing.
  getConfigFromDI: vi.fn(() => undefined),
}));

const executed: string[] = [];

/**
 * The adapter surface a create actually touches: the dialect it reports decides which DDL is
 * generated, `tableExists` decides whether the create is recorded as applied, and every statement
 * passes through `executeQuery`.
 */
function makeAdapter(dialect: "postgresql" | "mysql" | "sqlite") {
  // A field-group schema change runs inside the storage migration's lock, so the double has to
  // answer the lock's reads and writes as well as its own. Added rather than stubbed: a surface
  // that let every claim succeed would certify an exclusion that is not there.
  return withMigrationLockSurface({
    dialect,
    getCapabilities: () => ({ dialect }),
    // Answers the way a fresh create finds the database: the main table is there once its CREATE
    // has run, and the companion is NOT — so the companion path CREATEs it rather than altering
    // one that does not exist. A blanket `true` here made the companion look pre-existing, which
    // is not a state a create ever starts from.
    tableExists: vi.fn(async (name: string) => !name.includes("_locales")),
    executeQuery: vi.fn(async (sql: string) => {
      executed.push(sql);
      return [];
    }),
    getDrizzle: () => ({}),
  });
}

let adapter: ReturnType<typeof makeAdapter>;

vi.mock("../../../di/container", () => ({
  container: {
    // The adapter, plus a config carrying a `localization` block: creating a
    // localized field group is refused without one, so the localized case
    // below would never reach the DDL it asserts on. Nothing else is
    // registered, so this still exercises the DDL path and nothing more.
    has: vi.fn((key: string) => key === "adapter" || key === "config"),
    get: vi.fn((key: string) => {
      if (key === "adapter") return adapter;
      if (key === "config")
        return { localization: { locales: ["en"], defaultLocale: "en" } };
      return undefined;
    }),
  },
}));

import {
  isMigrationLockStatement,
  withMigrationLockSurface,
} from "../../../domains/field-groups/migration/__tests__/helpers/migration-lock-double";
import { FieldGroupMetadataService } from "../../../domains/field-groups/services/field-group-metadata-service";
import type { FieldGroupRegistryService } from "../../../services/field-groups/field-group-registry-service";
import type { Logger } from "../../../shared/types";
import {
  getAdapterFromDI,
  getComponentRegistryFromDI,
  getFieldGroupMetadataServiceFromDI,
} from "../../helpers/di";
import { dispatchComponents } from "../component-dispatcher";

function wireRegistry() {
  const registry = {
    listComponents: vi.fn(),
    registerComponent: vi.fn(async (row: unknown) => row),
    getComponent: vi.fn(),
    updateComponent: vi.fn(),
    deleteComponent: vi.fn(),
    // "No such slug" and "no field group owns that table", so a create reaches the DDL path.
    getComponentBySlug: vi.fn().mockResolvedValue(null),
    getAllComponents: vi.fn().mockResolvedValue([]),
    isLocked: vi.fn().mockResolvedValue(false),
  };
  vi.mocked(getComponentRegistryFromDI).mockReturnValue(
    registry as unknown as ReturnType<typeof getComponentRegistryFromDI>
  );
  // The REAL service over the same doubles, because the create path's behaviour IS this service's
  // behaviour: what the request forwards into the DDL is decided inside it, and a stub standing in
  // for it would leave every assertion below describing the stub.
  const silent: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  vi.mocked(getFieldGroupMetadataServiceFromDI).mockReturnValue(
    new FieldGroupMetadataService(
      registry as unknown as FieldGroupRegistryService,
      silent,
      adapter as unknown as ConstructorParameters<
        typeof FieldGroupMetadataService
      >[2]
    )
  );
  return registry;
}

/** Everything the adapter was asked to run, as one string. */
async function ddlFor(
  payload: Record<string, unknown>,
  dialect: "postgresql" | "mysql" | "sqlite" = "postgresql"
): Promise<string> {
  executed.length = 0;
  adapter = makeAdapter(dialect);
  // The handler reads the adapter through BOTH seams: `getAdapterFromDI` for the dialect it
  // generates with, and the container for the one it executes on. Wiring only one would leave the
  // dialect assertion below reading the service's own default while appearing to pass.
  vi.mocked(getAdapterFromDI).mockReturnValue(
    adapter as unknown as ReturnType<typeof getAdapterFromDI>
  );
  wireRegistry();
  await dispatchComponents("createComponent", {}, payload);
  return executed.join("\n");
}

beforeEach(() => {
  vi.mocked(getComponentRegistryFromDI).mockReset();
  vi.mocked(getFieldGroupMetadataServiceFromDI).mockReset();
  vi.mocked(getAdapterFromDI).mockReset();
});

describe("createComponent — what the request forwards into the DDL", () => {
  const base = {
    slug: "hero",
    label: "Hero",
    fields: [
      { name: "heading", type: "text" },
      { name: "weight", type: "number" },
    ],
  };

  it("creates the table the request names, with its fields", async () => {
    const sql = await ddlFor(base);

    expect(sql).toContain("comp_hero");
    expect(sql).toContain("heading");
    expect(sql).toContain("weight");
  });

  /**
   * A localized field group keeps its translatable columns in the companion `_locales` table, so
   * the main CREATE must omit them. Forwarding this wrongly leaves two homes for one value and the
   * companion holding nothing — and every generator snapshot still passes, because they are called
   * with `localized` spelled out.
   */
  it("moves translatable columns to the companion, not the main table", async () => {
    await ddlFor({
      ...base,
      localized: true,
      fields: [
        { name: "heading", type: "text", localized: true },
        { name: "weight", type: "number" },
      ],
    });

    // Scoped to the statement that creates each table. Asserting over ALL the SQL cannot express
    // this: the companion's own CREATE legitimately names the translatable column, so a bare
    // "the SQL does not mention heading" is either wrong or passes only because the companion
    // never ran — which is what happened before `getConfigFromDI` was mocked.
    const mainCreate = executed.find(
      s =>
        s.includes("CREATE TABLE") &&
        s.includes("comp_hero") &&
        !s.includes("_locales")
    );
    const companionCreate = executed.find(
      s => s.includes("CREATE TABLE") && s.includes("comp_hero_locales")
    );

    expect(mainCreate, "the main table is created").toBeDefined();
    expect(companionCreate, "the companion is created").toBeDefined();

    expect(mainCreate).not.toContain("heading");
    // The non-translatable field stays on the main table.
    expect(mainCreate).toContain("weight");
    // And the translatable one is on the companion — the half that proves it MOVED rather than
    // simply being dropped.
    expect(companionCreate).toContain("heading");
  });

  /**
   * The dialect comes from the adapter that will run the statements, never from a constant.
   *
   * This path currently falls back to the literal `"postgresql"` when no adapter is registered,
   * where the single path defers to the service's own default. That difference is resolved during
   * the relocation; what this pins is the case that matters either way — with an adapter present,
   * its dialect is the one used.
   */
  it.each([
    ["mysql", "`comp_hero`"],
    ["postgresql", '"comp_hero"'],
  ] as const)(
    "generates for the adapter's dialect (%s)",
    async (dialect, quoted) => {
      const sql = await ddlFor(base, dialect);

      expect(sql).toContain(quoted);
    }
  );

  /**
   * The parent pointer is what makes this a field-group table rather than an ordinary one, and it
   * is emitted by the generator this handler chooses. Pinned so a relocation that reached for the
   * collection generator instead would fail here rather than at a user's first write.
   */
  it("builds it with the field-group generator", async () => {
    const sql = await ddlFor(base);

    // The COLUMN, not merely the name. A bare `toContain("_parent_id")` is satisfied by the
    // CREATE INDEX that follows, so it passes even when the column itself is gone — verified by
    // removing the column definition and watching that weaker assertion stay green.
    expect(sql).toMatch(/"_parent_id"\s+\w+.*NOT NULL/i);
  });
});

/**
 * `diverged` means the tables moved and the row recording it did not, so the stored definition
 * describes the previous shape. Planning the next change from that shape is the retry the state
 * exists to declare unsafe — and the state is only a control if EVERY route that moves storage
 * asks it.
 *
 * 🔴 These exist because the refusal was added to `updateFieldGroup` and this route was left open.
 * Measured at the time: `grep -c diverged` over the apply handler returned ZERO while the service's
 * own guard read as complete. One transport enforcing and another not is worse than neither, since
 * the operator is told the edit is unsafe and then handed a door that performs it.
 */
describe("a diverged field group and the routes that move its storage", () => {
  const diverged = {
    slug: "hero",
    locked: false,
    migrationStatus: "diverged",
    fields: [],
    schemaVersion: 3,
  };

  it("refuses to apply schema changes", async () => {
    // Shared across the file, so it carries whatever earlier tests ran unless it is cleared here.
    executed.length = 0;
    adapter = makeAdapter("postgresql");
    vi.mocked(getAdapterFromDI).mockReturnValue(
      adapter as unknown as ReturnType<typeof getAdapterFromDI>
    );
    const registry = wireRegistry();
    registry.getComponent.mockResolvedValue(diverged);

    await expect(
      dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "hero" },
        { fields: [], confirmed: true, schemaVersion: 3 }
      )
    ).rejects.toMatchObject({
      code: "CONFLICT",
      logContext: { migrationStatus: "diverged" },
    });

    // 🔴 And it refused BEFORE touching the field group's storage. Asserting only the rejection
    // would pass on a handler that ran the DDL and then threw, which is the outcome this guard
    // exists to prevent.
    //
    // The lock's OWN table is excluded rather than counted: taking the exclusion is what lets the
    // guard read a status nothing can change underneath it, so its DDL is the refusal working. It
    // is separated with the shared identifier, so this cannot disagree with what the lock considers
    // its own.
    expect(executed.filter(sql => !isMigrationLockStatement(sql))).toEqual([]);
    // Positive control: the lock WAS taken, so the exclusion above is a real one rather than an
    // empty list that would satisfy the assertion just as well.
    expect(executed.some(isMigrationLockStatement)).toBe(true);
  });

  /**
   * Refusing is only half of it. `updateFieldGroup` commits its companion DDL, then persists the
   * row and the divergence marker as separate steps, so a status read taken OUTSIDE the exclusion
   * answers for an instant that has already passed: it can see the old value, pass the guard, and
   * start a second apply from a definition the tables have moved past.
   *
   * 🔴 Pinned as ORDERING rather than as the race. Holding the lock removes the interleaving
   * instead of detecting it, so no fixture can exhibit the bad outcome with the fix in place — the
   * observable difference is whether the exclusion is held AT THE MOMENT the status is read.
   */
  it("reads the status while holding the exclusion, not before taking it", async () => {
    executed.length = 0;
    adapter = makeAdapter("postgresql");
    vi.mocked(getAdapterFromDI).mockReturnValue(
      adapter as unknown as ReturnType<typeof getAdapterFromDI>
    );
    const registry = wireRegistry();

    // Sampled INSIDE the read the guard decides on, which is the only place the question means
    // anything. Asserting after the request would pass on a handler that read the status first and
    // took the lock afterwards.
    let ownerWhenStatusRead: string | null = null;
    registry.getComponent.mockImplementation(() => {
      ownerWhenStatusRead = adapter.migrationLock.ownerNow();
      return Promise.resolve(diverged);
    });

    await expect(
      dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "hero" },
        { fields: [], confirmed: true, schemaVersion: 3 }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Positive control: the read the assertion is about actually happened. Without it a handler
    // that never reached `getComponent` would leave the sample at its initial value and satisfy
    // nothing while appearing to.
    expect(registry.getComponent).toHaveBeenCalledTimes(1);
    expect(ownerWhenStatusRead).toMatch(/^apply schema changes to field group/);
  });

  it("still lets an operator READ one, because that is how it gets reconciled", async () => {
    adapter = makeAdapter("postgresql");
    vi.mocked(getAdapterFromDI).mockReturnValue(
      adapter as unknown as ReturnType<typeof getAdapterFromDI>
    );
    const registry = wireRegistry();
    registry.getComponent.mockResolvedValue(diverged);

    // Positive control on the pair: without this, guarding every route by slug would pass the test
    // above while locking the operator out of the state entirely.
    await expect(
      dispatchComponents("getComponent", { slug: "hero" }, {})
    ).resolves.toBeDefined();
  });
});
