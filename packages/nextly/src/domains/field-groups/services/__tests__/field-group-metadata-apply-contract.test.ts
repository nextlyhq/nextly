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
  // Returns whether DDL actually ran. Defaulted to `true` — "a transition happened" — because that
  // is the state the partial-failure tests below are about; the test that cares about the other
  // answer sets it explicitly rather than letting this double decide.
  reconcileComponentCompanion: vi.fn(async () => true),
  // The update path probes which discriminator column the existing table carries before it moves
  // anything. Stubbed to the current spelling: these tests are about which field CHANGES are
  // accepted, and a real probe would make every one of them a test of the catalog instead.
  resolveComponentTypeColumn: vi.fn(async () => "type"),
}));

// Enabling localization is gated on the app declaring a `localization` block, and that gate runs
// BEFORE the schema check these tests are about. Left real, a fixture that turns localization on
// is refused for a missing config and never reaches the guard — a test passing on the wrong
// rejection. Its own behaviour is covered where it lives.
vi.mock("../../../i18n/config/require-app-config", () => ({
  assertLocalizationConfigured: vi.fn(),
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
function adapterDouble(
  tableExists: () => Promise<boolean>,
  // The dialect the service reads its column shapes for. Parameterised because whether a change
  // needs DDL is a per-dialect question: the same `maxLength` edit alters a MySQL VARCHAR and
  // leaves a SQLite TEXT untouched, and a guard tested on one dialect says nothing about the other.
  dialect: "postgresql" | "mysql" | "sqlite" = "postgresql"
) {
  return withMigrationLockSurface({
    getCapabilities: () => ({ dialect }),
    // The parameter is declared even though nothing here reads it: `entityStatements` reads the
    // recorded calls, and a mock with no declared parameters records them as an empty tuple.
    executeQuery: vi.fn(async (_sql: string) => []),
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
    .map(([sql]) => sql)
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

/**
 * A registry that returns a stored field group, so an UPDATE can be driven through the service.
 *
 * `getComponent` is what the update re-reads inside the exclusion to re-establish its preconditions,
 * so it decides both the old field set the diff is taken against and whether the group is localized.
 */
function registryWithGroup(args: {
  fields: { name: string; type: string; localized?: boolean }[];
  localized?: boolean;
}) {
  const record = {
    slug: "hero",
    tableName: "comp_hero",
    fields: args.fields,
    localized: args.localized ?? false,
    locked: false,
    schemaVersion: 1,
  };
  return {
    getAllComponents: vi.fn().mockResolvedValue([]),
    registerComponent: vi.fn(async (row: unknown) => row),
    getComponent: vi.fn().mockResolvedValue(record),
    updateComponent: vi.fn(async () => record),
  };
}

describe("a field-group update refuses what it cannot deliver", () => {
  // 🔴 THE defect this guards. This path alters the COMPANION table only, so a field whose column
  // lives on the main table needs DDL it never emits — and before the guard the request answered
  // SUCCESS while writing a schema hash for columns that were never created.
  it("refuses a field that needs a column on the main table", async () => {
    const registry = registryWithGroup({
      fields: [{ name: "heading", type: "text" }],
    });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    const refusal = await service
      .updateFieldGroup({
        slug: "hero",
        fields: [
          { name: "heading", type: "text" },
          { name: "subheading", type: "text" },
        ] as never,
      })
      .catch((error: unknown) => error);

    // Asserted on the REASON, not the code: this method raises VALIDATION_ERROR for a malformed
    // plugin option too, so the code alone cannot tell the two apart.
    expect(refusal).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          expect.objectContaining({
            path: "fields.subheading",
            code: "requires_schema_change",
          }),
        ],
      },
    });
    // Nothing was written: a refusal has to happen before the row moves, not after.
    expect(registry.updateComponent).not.toHaveBeenCalled();
  });

  // 🔴 THE control that stops the guard from breaking the one path that works. A translatable field
  // on a LOCALIZED group lives in `comp_<slug>_locales`, which `reconcileCompanion` does apply — so
  // refusing it would take away working behaviour in the name of fixing a defect.
  it("allows a translatable field on a localized group, which the companion applies", async () => {
    const registry = registryWithGroup({
      localized: true,
      fields: [{ name: "heading", type: "text", localized: true }],
    });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    await expect(
      service.updateFieldGroup({
        slug: "hero",
        fields: [
          { name: "heading", type: "text", localized: true },
          { name: "subheading", type: "text", localized: true },
        ] as never,
      })
    ).resolves.toMatchObject({
      record: expect.objectContaining({ slug: "hero" }),
    });

    // 🔴 Asserted on the COMPANION CALL, not on the registry write. Checking only that the row was
    // updated leaves the control green if `reconcileCompanion` were removed or bypassed — the
    // promise still resolves and `updateComponent` is still reached, while `subheading` is never
    // added to `comp_hero_locales`. The claim is "the companion applies it", so the companion call
    // is what has to be observed.
    const { reconcileComponentCompanion } = await import(
      "../field-group-table-provisioning"
    );
    expect(reconcileComponentCompanion).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: "comp_hero",
        localized: true,
        newFields: expect.arrayContaining([
          expect.objectContaining({ name: "subheading" }),
        ]),
      })
    );
    expect(registry.updateComponent).toHaveBeenCalled();
  });

  // 🔴 THE case a definition-level diff cannot see. The field keeps its name and its `type`, so a
  // predicate comparing field definitions reports no change — while `integer` -> `decimal` alters
  // the column on every dialect. Comparing what the DDL generator would BUILD catches it; comparing
  // what the author wrote does not.
  it("refuses a storage change that leaves the field definition looking the same", async () => {
    const registry = registryWithGroup({
      fields: [{ name: "score", type: "number", dbType: "integer" }] as never,
    });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    const refusal = await service
      .updateFieldGroup({
        slug: "hero",
        fields: [{ name: "score", type: "number", dbType: "decimal" }] as never,
      })
      .catch((error: unknown) => error);

    expect(refusal).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          expect.objectContaining({
            path: "fields.score",
            code: "requires_schema_change",
          }),
        ],
      },
    });
    expect(registry.updateComponent).not.toHaveBeenCalled();
  });

  // 🔴 THE case a column comparison cannot see. `unique` creates `uq_<table>_<column>` and leaves
  // the column itself byte-identical, so a check that reads only the column shape accepts the edit
  // and the constraint is never created — duplicates stay physically permitted while the registry
  // records the field as unique.
  it("refuses a uniqueness change, which alters an index and not the column", async () => {
    const registry = registryWithGroup({
      fields: [{ name: "code", type: "text" }],
    });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    const refusal = await service
      .updateFieldGroup({
        slug: "hero",
        fields: [{ name: "code", type: "text", unique: true }] as never,
      })
      .catch((error: unknown) => error);

    expect(refusal).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          expect.objectContaining({
            path: "fields.code",
            code: "requires_schema_change",
          }),
        ],
      },
    });
    expect(registry.updateComponent).not.toHaveBeenCalled();
  });

  // 🔴 THE control against over-refusing. SQLite has one string type, so a `maxLength` edit renders
  // to the same TEXT column and needs no DDL at all. Refusing it would send a caller to an apply
  // flow for a database change that does not exist — and the Direct API has no apply flow to send
  // them to.
  it("allows a bound change that renders to the same column on this dialect", async () => {
    const registry = registryWithGroup({
      fields: [{ name: "heading", type: "text", maxLength: 100 }] as never,
    });
    const adapter = adapterDouble(async () => true, "sqlite");
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    await expect(
      service.updateFieldGroup({
        slug: "hero",
        fields: [{ name: "heading", type: "text", maxLength: 255 }] as never,
      })
    ).resolves.toMatchObject({
      record: expect.objectContaining({ slug: "hero" }),
    });
  });

  // 🔴 THE case the main table cannot see, because the column is not on it. A localized field's
  // column lives in `comp_<slug>_locales`, and the companion reconciler diffs that table by NAME
  // only — so a same-named field whose storage changes emits no ALTER there either, and the group
  // would advance describing a column shape the companion does not have.
  it("refuses a storage change to a field whose column lives in the companion", async () => {
    const registry = registryWithGroup({
      localized: true,
      fields: [
        { name: "score", type: "number", dbType: "integer", localized: true },
      ] as never,
    });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    const refusal = await service
      .updateFieldGroup({
        slug: "hero",
        fields: [
          { name: "score", type: "number", dbType: "decimal", localized: true },
        ] as never,
      })
      .catch((error: unknown) => error);

    expect(refusal).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          expect.objectContaining({
            path: "fields.score",
            code: "requires_schema_change",
          }),
        ],
      },
    });
    expect(registry.updateComponent).not.toHaveBeenCalled();
  });

  // 🔴 THE case that DESTROYS content rather than leaving a stale shape. `heading` -> `title` on an
  // already-localized group is invisible to a name-keyed comparison, and the companion reconciler
  // reads it as ADD `title`, DROP `heading` — every stored translation goes with the drop, with no
  // rename resolution because a PATCH has nowhere to ask the question.
  it("refuses a rename on a localized group, which the companion would apply as a drop", async () => {
    const registry = registryWithGroup({
      localized: true,
      fields: [{ name: "heading", type: "text", localized: true }],
    });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    const refusal = await service
      .updateFieldGroup({
        slug: "hero",
        fields: [{ name: "title", type: "text", localized: true }] as never,
      })
      .catch((error: unknown) => error);

    expect(refusal).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: expect.arrayContaining([
          expect.objectContaining({
            path: "fields.title",
            code: "requires_schema_change",
          }),
          expect.objectContaining({
            path: "fields.heading",
            code: "requires_schema_change",
          }),
        ]),
      },
    });
    expect(registry.updateComponent).not.toHaveBeenCalled();
  });

  // 🔴 The same ambiguity through the OTHER companion path. Enabling localization while renaming
  // hides the change twice over: both names are translatable under the requested state, so neither
  // appears on the main table, and the enable planner seeds only new columns whose name already
  // exists on main — so `title` is seeded from nothing and `heading` is left behind on main.
  it("refuses a rename that arrives with localization being enabled", async () => {
    const registry = registryWithGroup({
      localized: false,
      fields: [{ name: "heading", type: "text", localized: true }],
    });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    const refusal = await service
      .updateFieldGroup({
        slug: "hero",
        localized: true,
        fields: [{ name: "title", type: "text", localized: true }] as never,
      })
      .catch((error: unknown) => error);

    expect(refusal).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: expect.arrayContaining([
          expect.objectContaining({ code: "requires_schema_change" }),
        ]),
      },
    });
    expect(registry.updateComponent).not.toHaveBeenCalled();
  });

  // 🔴 THE property the desired-table builder drops on purpose. It carries no DEFAULT for a user
  // column, because the diff engine compares it against a live database whose reported defaults
  // would otherwise churn — but the field group's CREATOR does emit a checkbox default, so a
  // `defaultValue` edit changes the column while leaving the desired table byte-identical.
  it("refuses a checkbox default change, which the desired table does not carry", async () => {
    const registry = registryWithGroup({
      fields: [
        { name: "featured", type: "checkbox", defaultValue: false },
      ] as never,
    });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    const refusal = await service
      .updateFieldGroup({
        slug: "hero",
        fields: [
          { name: "featured", type: "checkbox", defaultValue: true },
        ] as never,
      })
      .catch((error: unknown) => error);

    expect(refusal).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          expect.objectContaining({
            path: "fields.featured",
            code: "requires_schema_change",
          }),
        ],
      },
    });
    expect(registry.updateComponent).not.toHaveBeenCalled();
  });

  // 🔴 THE one-sided case the PAIR rule cannot see. Enabling localization while REMOVING a
  // translatable field: the removal has no matching add, so the rename check passes it, both main
  // snapshots omit the field because it is translatable under the requested state, and the enable
  // planner derives its companion from the NEW fields alone — so nothing drops the column that is
  // still physically on the main table. The registry would stop describing a field whose data is
  // sitting on a column nothing will read again.
  it("refuses removing a translatable field while localization is being enabled", async () => {
    const registry = registryWithGroup({
      localized: false,
      fields: [
        { name: "heading", type: "text", localized: true },
        { name: "body", type: "text", localized: true },
      ] as never,
    });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    const refusal = await service
      .updateFieldGroup({
        slug: "hero",
        localized: true,
        fields: [{ name: "heading", type: "text", localized: true }] as never,
      })
      .catch((error: unknown) => error);

    expect(refusal).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: expect.arrayContaining([
          expect.objectContaining({
            path: "fields.body",
            code: "requires_schema_change",
          }),
        ]),
      },
    });
    expect(registry.updateComponent).not.toHaveBeenCalled();
  });

  // The control that keeps the enable path usable: a plain enable, dropping nothing, still works.
  // Without it a rule that refused every enable would satisfy the case above.
  it("allows a plain enable that removes no translatable field", async () => {
    const registry = registryWithGroup({
      localized: false,
      fields: [{ name: "heading", type: "text", localized: true }] as never,
    });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    await expect(
      service.updateFieldGroup({ slug: "hero", localized: true })
    ).resolves.toMatchObject({
      record: expect.objectContaining({ slug: "hero" }),
    });
  });

  // 🔴 The control that scopes the rule above to ENABLEMENT. On a group that is ALREADY localized
  // the companion exists, so `buildCompanionReconcileStatements` emits a real DROP COLUMN for a
  // removed translatable field — that is appliable, and refusing it would take working behaviour
  // away. Without this, a rule that read the localization state wrongly and refused every drop
  // would still satisfy the enablement case.
  it("allows removing a translatable field from an already-localized group", async () => {
    const registry = registryWithGroup({
      localized: true,
      fields: [
        { name: "heading", type: "text", localized: true },
        { name: "body", type: "text", localized: true },
      ] as never,
    });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    await expect(
      service.updateFieldGroup({
        slug: "hero",
        fields: [{ name: "heading", type: "text", localized: true }] as never,
      })
    ).resolves.toMatchObject({
      record: expect.objectContaining({ slug: "hero" }),
    });
  });

  // 🔴 THE transition a column-shape comparison cannot see, because one side HAS no column. A
  // localized `component` field stores its data in its own table and materialises nothing in the
  // companion; changing it to `text` under the same name needs an ADD COLUMN that the reconciler
  // never emits — it diffs raw localized NAMES, and the name was already there. The registry and
  // the runtime would advance to a companion column nothing created.
  it("refuses a localized field that gains a companion column under the same name", async () => {
    const registry = registryWithGroup({
      localized: true,
      fields: [{ name: "body", type: "component", localized: true }] as never,
    });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    const refusal = await service
      .updateFieldGroup({
        slug: "hero",
        fields: [{ name: "body", type: "text", localized: true }] as never,
      })
      .catch((error: unknown) => error);

    expect(refusal).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: expect.arrayContaining([
          expect.objectContaining({
            path: "fields.body",
            code: "requires_schema_change",
          }),
        ]),
      },
    });
    expect(registry.updateComponent).not.toHaveBeenCalled();
  });

  // The reverse, which strands the old column instead of missing a new one.
  it("refuses a localized field that loses its companion column", async () => {
    const registry = registryWithGroup({
      localized: true,
      fields: [{ name: "body", type: "text", localized: true }] as never,
    });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    const refusal = await service
      .updateFieldGroup({
        slug: "hero",
        fields: [{ name: "body", type: "component", localized: true }] as never,
      })
      .catch((error: unknown) => error);

    expect(refusal).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: expect.arrayContaining([
          expect.objectContaining({ code: "requires_schema_change" }),
        ]),
      },
    });
    expect(registry.updateComponent).not.toHaveBeenCalled();
  });

  // 🔴 The cost of recording columnless fields in the companion map, corrected. Swapping one
  // `component` field for a differently named one is one add and one drop BY KEY, which reads as a
  // rename pair — while neither materialises a companion column and the reconciler emits nothing
  // for either. Refusing it would reject a safe metadata-only edit.
  it("allows swapping one columnless localized field for another", async () => {
    const registry = registryWithGroup({
      localized: true,
      fields: [{ name: "body", type: "component", localized: true }] as never,
    });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    await expect(
      service.updateFieldGroup({
        slug: "hero",
        fields: [
          { name: "aside", type: "component", localized: true },
        ] as never,
      })
    ).resolves.toMatchObject({
      record: expect.objectContaining({ slug: "hero" }),
    });
  });

  // The control that keeps the narrowing from swallowing the rename it was carved out of: two
  // fields that DO render columns, swapped, is still the destructive pair.
  it("still refuses a rename between two column-backed localized fields", async () => {
    const registry = registryWithGroup({
      localized: true,
      fields: [{ name: "body", type: "text", localized: true }] as never,
    });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    const refusal = await service
      .updateFieldGroup({
        slug: "hero",
        fields: [{ name: "aside", type: "text", localized: true }] as never,
      })
      .catch((error: unknown) => error);

    expect(refusal).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: expect.arrayContaining([
          expect.objectContaining({ code: "requires_schema_change" }),
        ]),
      },
    });
  });

  // A layout-only field has no column anywhere, so adding one cannot need DDL on any table.
  it("allows a field that produces no column at all", async () => {
    const registry = registryWithGroup({
      fields: [{ name: "heading", type: "text" }],
    });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    await expect(
      service.updateFieldGroup({
        slug: "hero",
        fields: [
          { name: "heading", type: "text" },
          { name: "layout", type: "component" },
        ] as never,
      })
    ).resolves.toMatchObject({
      record: expect.objectContaining({ slug: "hero" }),
    });
  });
});

describe("an update whose row write fails after the tables moved", () => {
  /** A registry holding one field group, whose row write fails the first time it is attempted. */
  function registryWhoseWriteFails(args: {
    localized?: boolean;
    failure?: unknown;
  }) {
    const record = {
      id: "fg-1",
      slug: "hero",
      tableName: "comp_hero",
      label: "Hero",
      // 🔴 Localized, with a TRANSLATABLE field. These tests are about what happens when the row
      // write fails AFTER the tables moved, so the edit has to be one this path can actually
      // deliver: a field set change on a non-localized group needs a main-table column and is
      // refused before it ever reaches the record step, which would make every assertion below
      // describe the wrong rejection.
      fields: [{ name: "heading", type: "text", localized: true }],
      localized: args.localized ?? true,
      locked: false,
      schemaVersion: 1,
    };
    let attempts = 0;
    return {
      record,
      getAllComponents: vi.fn().mockResolvedValue([]),
      registerComponent: vi.fn(async (row: unknown) => row),
      getComponent: vi.fn().mockResolvedValue(record),
      // Fails the real write and accepts the narrow status mark that follows it, which is the whole
      // reason the mark is worth attempting: a single-column update survives the failures that
      // realistically break a full row write.
      // The parameters are declared even though nothing here reads them: a mock with no declared
      // parameters records its calls as an empty tuple, so indexing into one is a type error rather
      // than the assertion it was written as.
      updateComponent: vi.fn(
        async (
          _slug: string,
          _data: Record<string, unknown>,
          _options?: { source?: string }
        ) => {
          attempts += 1;
          if (attempts === 1)
            throw args.failure ?? new Error("row write rejected");
          return record;
        }
      ),
    };
  }

  it("tells the caller the change stands, and marks the row failed", async () => {
    const registry = registryWhoseWriteFails({});
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    const refusal = await service
      .updateFieldGroup({
        slug: "hero",
        fields: [
          { name: "heading", type: "text", localized: true },
          { name: "subheading", type: "text", localized: true },
        ] as never,
      })
      .catch((error: unknown) => error);

    // Asserted on the MESSAGE, not only the code. The registry's own failure is an internal error
    // too, so the code alone cannot separate "the write failed and nothing happened" from "the
    // write failed and the tables already moved" — and only the second may not be retried.
    expect(refusal).toBeInstanceOf(NextlyError);
    expect((refusal as NextlyError).code).toBe("INTERNAL_ERROR");
    expect((refusal as NextlyError).publicMessage).toContain(
      "Do not retry the same edit"
    );

    // The transition really did run, so this is describing the state it claims to describe rather
    // than a request that failed earlier.
    const { reconcileComponentCompanion } = await import(
      "../field-group-table-provisioning"
    );
    expect(reconcileComponentCompanion).toHaveBeenCalled();

    // The divergence is RECORDED, not merely raised: the raise reaches one caller once, the row is
    // what anyone looking later can see.
    expect(registry.updateComponent).toHaveBeenCalledTimes(2);
    // 🔴 `diverged`, NOT `failed`. The canonical type documents `failed` as a table-creation
    // failure whose repair is to retry, which is the exact action that compounds this one: a retry
    // derives `wasLocalized` from a row that already describes the wrong shape. Once the one-time
    // error response is gone, this column is the only thing telling a recovery tool which of the
    // two it is looking at.
    expect(registry.updateComponent.mock.calls[1]?.[1]).toEqual({
      migrationStatus: "diverged",
    });
    // The optimistic lock is invalidated with it: the tables moved, so every editor loaded before
    // this moment is describing a shape that no longer exists.
    expect(registry.updateComponent.mock.calls[1]?.[2]).toMatchObject({
      invalidateSchemaVersion: true,
    });
  });

  // 🔴 THE case the request shape cannot answer. A field-set change on a group that was and remains
  // non-localized reaches the reconciler and moves nothing — this path emits no main-table DDL — so
  // a failed write there has changed nothing and must not be reported as a committed transition.
  it("raises the original error when the reconciler reports nothing moved", async () => {
    const failure = new Error("row write rejected");
    const registry = registryWhoseWriteFails({ failure });
    const adapter = adapterDouble(async () => true);
    const { reconcileComponentCompanion } = await import(
      "../field-group-table-provisioning"
    );
    vi.mocked(reconcileComponentCompanion).mockResolvedValueOnce(false);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    const refusal = await service
      .updateFieldGroup({
        slug: "hero",
        fields: [{ name: "heading", type: "text", localized: true }] as never,
      })
      .catch((error: unknown) => error);

    // The registry's own error, verbatim. Wrapping it would tell a caller their edit half-happened
    // when it did not happen at all.
    expect(refusal).toBe(failure);
    // And no mark: a row that still describes the database correctly needs no repair recorded.
    expect(registry.updateComponent).toHaveBeenCalledTimes(1);
  });

  // 🔴 MySQL has no `RETURNING`, so `DrizzleAdapter.update` UPDATEs and then SELECTs the row back
  // (`adapter.ts:1339-1345`). A failure in that second query raises out of a write that already
  // committed — and marking a synchronized row as diverged, bumping its version again and telling
  // the caller its definition is stale would all be false.
  it("returns the row when the write landed and only the read-back failed", async () => {
    const registry = registryWhoseWriteFails({});
    // The row the re-read finds: already carrying this edit's field set, which is what a committed
    // UPDATE followed by a failed SELECT leaves behind.
    const settledHash = await (async () => {
      const { calculateSchemaHash } = await import(
        "../../../schema/services/schema-hash"
      );
      // 🔴 The SAME field set the update below sends. Computing it from a different shape makes
      // the service read the settled row as carrying someone else's edit, conclude the write never
      // landed, and record a divergence — the test would then fail for a reason that has nothing to
      // do with the read-back it is about.
      return calculateSchemaHash([
        { name: "heading", type: "text", localized: true },
        { name: "subheading", type: "text", localized: true },
      ] as never);
    })();
    registry.getComponent = vi.fn().mockResolvedValue({
      ...registry.record,
      schemaHash: settledHash,
    });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    const result = await service.updateFieldGroup({
      slug: "hero",
      fields: [
        { name: "heading", type: "text", localized: true },
        { name: "subheading", type: "text", localized: true },
      ] as never,
    });

    expect(result.record).toMatchObject({ slug: "hero" });
    // 🔴 And NOTHING was marked. Asserting only that it resolved would pass on an implementation
    // that recorded a divergence and then returned anyway.
    expect(registry.updateComponent).toHaveBeenCalledTimes(1);
  });

  // The control that keeps the re-read from swallowing a real divergence: a row that does NOT
  // carry the edit still takes the diverged path.
  it("still records the divergence when the re-read shows the old shape", async () => {
    const registry = registryWhoseWriteFails({});
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    const refusal = await service
      .updateFieldGroup({
        slug: "hero",
        fields: [
          { name: "heading", type: "text", localized: true },
          { name: "subheading", type: "text", localized: true },
        ] as never,
      })
      .catch((error: unknown) => error);

    expect((refusal as NextlyError).publicMessage).toContain(
      "Do not retry the same edit"
    );
    expect(registry.updateComponent).toHaveBeenCalledTimes(2);
  });

  // 🔴 Recording `diverged` is only half a control. Without a refusal, an editor opened AFTER the
  // mark reads the bumped `schema_version` with the STALE stored fields, satisfies
  // `assertSchemaVersionMatch`, and plans its next transition from a shape the tables no longer
  // have — the exact retry this state exists to declare unsafe.
  it("refuses a schema edit on a field group already marked diverged", async () => {
    const registry = registryWhoseWriteFails({});
    registry.getComponent = vi
      .fn()
      .mockResolvedValue({ ...registry.record, migrationStatus: "diverged" });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    const refusal = await service
      .updateFieldGroup({
        slug: "hero",
        fields: [{ name: "heading", type: "text", localized: true }] as never,
      })
      .catch((error: unknown) => error);

    // Asserted on the REASON as well as the code: a stale-version conflict is also a CONFLICT here,
    // and its message tells the caller to refresh and retry — the opposite of what this one means.
    expect(refusal).toMatchObject({ code: "CONFLICT" });
    expect((refusal as NextlyError).publicMessage).toContain(
      "Reconcile the definition against the tables"
    );
    // Refused BEFORE anything moved: a guard that ran after the transition would be describing a
    // second divergence rather than preventing one.
    const { reconcileComponentCompanion } = await import(
      "../field-group-table-provisioning"
    );
    expect(reconcileComponentCompanion).not.toHaveBeenCalled();
    expect(registry.updateComponent).not.toHaveBeenCalled();
  });

  // The control that keeps the refusal from stranding an operator. A label edit moves no storage,
  // so locking it out would make a diverged field group harder to reconcile rather than safer.
  it("still allows a metadata-only edit while diverged", async () => {
    const registry = registryWhoseWriteFails({});
    registry.getComponent = vi
      .fn()
      .mockResolvedValue({ ...registry.record, migrationStatus: "diverged" });
    registry.updateComponent = vi.fn(
      async (
        _slug: string,
        _data: Record<string, unknown>,
        _options?: { source?: string }
      ) => registry.record
    );
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    await expect(
      service.updateFieldGroup({ slug: "hero", label: "Hero (renamed)" })
    ).resolves.toMatchObject({
      record: expect.objectContaining({ slug: "hero" }),
    });
  });

  it("raises the original error, unmarked, when nothing physical moved", async () => {
    // 🔴 The control that stops this becoming a blanket rewrite of every failed update. A label-only
    // edit issues no DDL, so a failed write leaves the row describing the database correctly. There
    // is no divergence, and marking one would invent a repair for a state that is fine.
    const failure = new Error("row write rejected");
    const registry = registryWhoseWriteFails({ failure });
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    const refusal = await service
      .updateFieldGroup({ slug: "hero", label: "Hero (renamed)" })
      .catch((error: unknown) => error);

    expect(refusal).toBe(failure);
    expect(registry.updateComponent).toHaveBeenCalledTimes(1);
  });

  it("still raises when the row could not even be marked", async () => {
    // Best effort means the mark's own failure must not replace the diagnosis the caller needs.
    const registry = registryWhoseWriteFails({});
    registry.updateComponent = vi.fn(
      async (
        _slug: string,
        _data: Record<string, unknown>,
        _options?: { source?: string }
      ) => {
        throw new Error("database unreachable");
      }
    );
    const adapter = adapterDouble(async () => true);
    const service = serviceOver(
      registry as unknown as ReturnType<typeof registryDouble>,
      adapter
    );

    const refusal = await service
      .updateFieldGroup({
        slug: "hero",
        fields: [
          { name: "heading", type: "text", localized: true },
          { name: "subheading", type: "text", localized: true },
        ] as never,
      })
      .catch((error: unknown) => error);

    expect((refusal as NextlyError).publicMessage).toContain(
      "Do not retry the same edit"
    );
    // 🔴 And it must NOT claim a durable record it does not have. The mark failed too, so the only
    // trace is the server log — telling an operator the row is marked sends them to a row that
    // reads entirely normal.
    expect((refusal as NextlyError).publicMessage).toContain(
      "the only trace is the server log"
    );
    expect((refusal as NextlyError).publicMessage).not.toContain(
      "is marked as diverged"
    );
    // The mark was attempted and refused, which is the state this describes. Asserting only the
    // raise would pass on an implementation that never tried.
    expect(registry.updateComponent).toHaveBeenCalledTimes(2);
  });
});
