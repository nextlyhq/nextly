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
  // anything. Stubbed to the current spelling: an unstubbed export throws on call, and the update
  // tests below would then be describing a companion transition that never started.
  resolveComponentTypeColumn: vi.fn(async () => "type"),
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
 * The two halves of an update cannot be made atomic — MySQL commits DDL implicitly — so the state
 * where the tables moved and the row did not is reachable by construction rather than by neglect.
 *
 * What it must not be is SILENT, and it must not read to the caller as "nothing happened": the
 * registry's own error says that, and acting on it means retrying an edit whose first half already
 * stands. A retry re-derives `wasLocalized` from a row that still holds the old value, so an enable
 * would seed the companion a second time from main-table columns the first attempt dropped.
 */
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
      fields: [{ name: "heading", type: "text" }],
      localized: args.localized ?? false,
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
          { name: "heading", type: "text" },
          { name: "subheading", type: "text" },
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
        fields: [{ name: "heading", type: "text" }] as never,
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
      return calculateSchemaHash([
        { name: "heading", type: "text" },
        { name: "subheading", type: "text" },
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
        { name: "heading", type: "text" },
        { name: "subheading", type: "text" },
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
          { name: "heading", type: "text" },
          { name: "subheading", type: "text" },
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
        fields: [{ name: "heading", type: "text" }] as never,
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
          { name: "heading", type: "text" },
          { name: "subheading", type: "text" },
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
