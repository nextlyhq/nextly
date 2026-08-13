/**
 * The apply half records its outcome instead of raising it, including when the CHECK fails.
 *
 * `createFieldGroup` runs the DDL and then writes a registry row carrying how far it got. That only
 * works if the apply never throws: a rejection there takes the registry write with it and leaves a
 * table that was just created with nothing describing it — findable only by guessing at names.
 *
 * The statements themselves were already inside a catch. The verification that follows them was
 * not, and it is a query like any other: `tableExists` re-raises what the driver hands it, so a
 * momentary connection failure at that instant orphaned the table it had just made. It is the
 * confirmation step, so it fails exactly when the database is least healthy.
 *
 * Driven through doubles rather than an engine because the case being described is a query failure
 * at one specific moment, which a real database will not reproduce on request.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every table the runtime was pointed at, in order.
 *
 * Recorded rather than asserted through a spy on the module, because WHEN this happens is the
 * behaviour under test: the list has to be empty for a create whose row was rejected.
 */
const bound: string[] = [];

vi.mock("../field-group-table-provisioning", () => ({
  registerComponentRuntimeSchema: vi.fn((_a, _d, tableName: string) => {
    bound.push(tableName);
  }),
  reconcileComponentCompanion: vi.fn(async () => {}),
}));

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../../errors";
import type { Logger } from "../../../../shared/types";
import {
  isMigrationLockStatement,
  withMigrationLockSurface,
} from "../../migration/__tests__/helpers/migration-lock-double";
import type { FieldGroupRegistryService } from "../field-group-registry-service";
import {
  FieldGroupMetadataService,
  type CreateFieldGroupInput,
} from "../field-group-metadata-service";

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const INPUT: CreateFieldGroupInput = {
  slug: "hero",
  label: "Hero",
  tableName: "comp_hero",
  fields: [{ name: "heading", type: "text" }],
  source: "ui",
  locked: false,
  // Required by the input type, and carried through to the row unchanged. Its value is irrelevant
  // to what these assert; its presence is not, because the type is the registry's own insert shape
  // and a subset would stop describing what a create actually writes.
  schemaHash: "hash-for-the-fields-above",
};

/** A registry holding nothing, so the ownership check passes and the create proceeds. */
function registryDouble() {
  return {
    getAllComponents: vi.fn().mockResolvedValue([]),
    registerComponent: vi.fn(async (row: unknown) => row),
  };
}

/**
 * An adapter that runs DDL happily and answers the verification however the test needs.
 *
 * A create now runs inside the storage migration's lock, so the double carries the lock's surface
 * too, and `nextly_meta` answers absent — a fixture that has never recorded a migration marker.
 * That leaves the supplied `tableExists` governing the VERIFICATION probe alone, which is the
 * failure these tests inject; routing it into the exclusion's probe as well would refuse the create
 * before it started, and every assertion below would be describing a different path.
 */
function adapterDouble(tableExists: () => Promise<boolean>) {
  return withMigrationLockSurface({
    getCapabilities: () => ({ dialect: "postgresql" as const }),
    executeQuery: vi.fn(async () => []),
    tableExists: vi.fn(async (name: string) =>
      name === "nextly_meta" ? false : tableExists()
    ),
  });
}

/**
 * The statements the create issued for its OWN table.
 *
 * Taking the lock issues DDL for the lock's table, so "the adapter executed nothing" no longer
 * separates a create that built a table from one that never got that far. This does.
 */
function entityStatements(adapter: ReturnType<typeof adapterDouble>): string[] {
  return adapter.executeQuery.mock.calls
    .map(([sql]) => sql as string)
    .filter(sql => !isMigrationLockStatement(sql));
}

function serviceOver(
  registry: ReturnType<typeof registryDouble>,
  adapter: ReturnType<typeof adapterDouble>
) {
  return new FieldGroupMetadataService(
    registry as unknown as FieldGroupRegistryService,
    logger,
    adapter as unknown as DrizzleAdapter
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  bound.length = 0;
});

describe("a field-group create records its outcome rather than raising it", () => {
  it("records failed, and still writes the row, when the verification query fails", async () => {
    const registry = registryDouble();
    const adapter = adapterDouble(async () => {
      throw new Error("connection terminated unexpectedly");
    });

    const { migrationStatus } = await serviceOver(
      registry,
      adapter
    ).createFieldGroup(INPUT);

    expect(migrationStatus).toBe("failed");
    // The half that matters: a row exists describing what was attempted, so the table is not
    // orphaned and the state is repairable.
    expect(registry.registerComponent).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: "comp_hero",
        migrationStatus: "failed",
      })
    );
  });

  it("records failed when the verification says the table is not there", async () => {
    // The other way the same check can answer, kept alongside so a fix to the throwing case cannot
    // quietly drop the answer this one depends on.
    const registry = registryDouble();
    const adapter = adapterDouble(async () => false);

    const { migrationStatus } = await serviceOver(
      registry,
      adapter
    ).createFieldGroup(INPUT);

    expect(migrationStatus).toBe("failed");
    expect(registry.registerComponent).toHaveBeenCalled();
  });

  it("refuses before running any DDL when another field group owns the table", async () => {
    const registry = registryDouble();
    registry.getAllComponents.mockResolvedValue([
      { slug: "hero_legacy", tableName: "comp_hero" },
    ]);
    const adapter = adapterDouble(async () => true);

    await expect(
      serviceOver(registry, adapter).createFieldGroup(INPUT)
    ).rejects.toMatchObject({ code: "DUPLICATE" });

    // Nothing ran and nothing was written. A refusal that has already touched the table would have
    // rebound the existing field group's storage to this request's fields.
    expect(entityStatements(adapter)).toEqual([]);
    expect(registry.registerComponent).not.toHaveBeenCalled();
  });
});

/**
 * What separates two creates that both want the same table.
 *
 * The ownership check cannot exclude a write that has not happened yet, so two requests whose slugs
 * normalise to one table can both pass it. The registry's `table_name` unique index is what actually
 * decides between them — and that only helps if nothing irreversible has already happened.
 *
 * Binding the runtime schema is irreversible in the sense that matters: it describes the shared table
 * to the running process. Done before the insert, the request that loses rebinds the winner's table
 * to ITS field list and only then fails, leaving reads and writes going through a schema that
 * describes the wrong field group until a restart. So the binding has to happen after the insert
 * that would reject it.
 */
describe("a create that loses the race changes nothing", () => {
  it("does not bind the runtime schema when the registry rejects the row", async () => {
    const registry = registryDouble();
    // Passes the ownership check — the state a racing pair is in, since neither row exists yet —
    // and then fails at the INSERT, which is where the database serialises them.
    registry.registerComponent.mockRejectedValue(
      NextlyError.duplicate({ logContext: { reason: "table-name-unique" } })
    );
    const adapter = adapterDouble(async () => true);

    await expect(
      serviceOver(registry, adapter).createFieldGroup(INPUT)
    ).rejects.toMatchObject({ code: "DUPLICATE" });

    // The table itself was created, which is expected and harmless: the DDL is idempotent and the
    // winner owns the same table. What must NOT have happened is the rebind.
    expect(bound).toHaveLength(0);
  });

  it("binds the runtime schema when the row is written", async () => {
    // The positive control. Without it, a service that never bound at all would satisfy the case
    // above while leaving every successful create invisible to the running process.
    const registry = registryDouble();
    const adapter = adapterDouble(async () => true);

    await serviceOver(registry, adapter).createFieldGroup(INPUT);

    expect(bound).toEqual(["comp_hero"]);
  });
});

/**
 * Names the database would not store intact are refused before anything runs.
 *
 * A slug bound cannot cover this. The generator names a field's index `idx_<tableName>_<columnName>`,
 * so the longest identifier depends on the slug AND the longest indexed field name — two independent
 * inputs, neither of which constrains the other. A slug inside its own limit, paired with an ordinary
 * field name, still produces an index name past what MySQL accepts and PostgreSQL stores.
 *
 * The failure it prevents is a partial one: the table and its parent index are created, the field
 * index fails, and the caller receives a record whose migration is recorded failed — a field group
 * that exists and cannot be queried, made by a request that returned a success shape.
 */
describe("a create whose generated names would not fit is refused", () => {
  const longSlugTable = `comp_${"a".repeat(47)}`;

  it("counts the field's index name, not only the slug", async () => {
    const registry = registryDouble();
    const adapter = adapterDouble(async () => true);

    // The slug is AT its own bound — `comp_<47>` is 52, and its parent index is exactly 63. What
    // pushes it over is the field: `idx_comp_<47>_author_id` is 66.
    await expect(
      serviceOver(registry, adapter).createFieldGroup({
        ...INPUT,
        tableName: longSlugTable,
        fields: [{ name: "authorId", type: "text", index: true }],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // Before any DDL, which is the whole point: a refusal that has already run statements leaves
    // exactly the half-made field group this exists to prevent.
    expect(entityStatements(adapter)).toEqual([]);
    expect(registry.registerComponent).not.toHaveBeenCalled();
  });

  it("counts a unique index, which is named differently from a plain one", async () => {
    // `uq_<table>_<column>`, emitted by its own loop. An enumeration that walked the fields looking
    // for `index: true` missed this entirely, because a unique field need not set it.
    const registry = registryDouble();
    const adapter = adapterDouble(async () => true);

    await expect(
      serviceOver(registry, adapter).createFieldGroup({
        ...INPUT,
        tableName: longSlugTable,
        fields: [{ name: "authorId", type: "text", unique: true }],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(entityStatements(adapter)).toEqual([]);
  });

  it("counts the column's own name, not only names derived from it", async () => {
    // A column IS an identifier. A field named past the limit makes MySQL reject the CREATE TABLE
    // itself — before any index exists to be named.
    const registry = registryDouble();
    const adapter = adapterDouble(async () => true);

    await expect(
      serviceOver(registry, adapter).createFieldGroup({
        ...INPUT,
        fields: [{ name: "a".repeat(65), type: "text" }],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(entityStatements(adapter)).toEqual([]);
  });

  it("does not count an index the renderer never emits", async () => {
    // 🔴 A localized field's column lives in the companion, so the main table gets no index for it
    // and no such name is ever generated. Rejecting this request would refuse a VALID create over an
    // identifier that does not exist — a false refusal, which is worse than the miss it came from.
    const registry = registryDouble();
    const adapter = adapterDouble(async () => true);

    const { migrationStatus } = await serviceOver(
      registry,
      adapter
    ).createFieldGroup({
      ...INPUT,
      tableName: longSlugTable,
      localized: true,
      fields: [
        { name: "authorId", type: "text", index: true, localized: true },
      ],
    });

    expect(migrationStatus).toBe("applied");
  });

  it("allows the same slug when no field derives a longer name", async () => {
    // The positive control. Without it, a rule that rejected every long slug would satisfy the case
    // above while refusing creates that are perfectly legal.
    const registry = registryDouble();
    const adapter = adapterDouble(async () => true);

    const { migrationStatus } = await serviceOver(
      registry,
      adapter
    ).createFieldGroup({
      ...INPUT,
      tableName: longSlugTable,
      fields: [{ name: "body", type: "text" }],
    });

    expect(migrationStatus).toBe("applied");
  });
});
