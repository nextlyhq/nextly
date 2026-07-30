import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { MetaService } from "../../../meta/services/meta-service";
import {
  buildMigrationManifest,
  hashManifest,
  type ManifestEntry,
} from "../manifest";
import {
  advanceStep,
  MAX_MIGRATION_STEP,
  assertPlanUnchanged,
  beginMigration,
  FIELD_GROUP_MIGRATION_KEY,
  MIGRATION_MARKER_VERSION,
  readMigrationState,
  settleMigration,
} from "../state";

/** Absence is a distinct state from "stored, but holding nothing readable". */
const ABSENT = Symbol("absent");

/**
 * Stands in for `nextly_meta`. The real service round-trips JSON through a
 * column, so the fake stores the value it was handed and returns it verbatim.
 *
 * `getEntry` is what the marker reads through, because it is the only accessor
 * that separates an absent row from a present row carrying `null`.
 */
function createMeta(initial: unknown = ABSENT): {
  meta: MetaService;
  read: () => unknown;
} {
  let stored = initial;
  const meta = {
    getEntry: vi.fn(async () =>
      stored === ABSENT ? { present: false } : { present: true, value: stored }
    ),
    get: vi.fn(async () => (stored === ABSENT ? null : stored)),
    set: vi.fn(async (_key: string, value: unknown) => {
      stored = value;
    }),
  } as unknown as MetaService;
  return { meta, read: () => stored };
}

/**
 * A minimal canonical plan. `parseAppliedManifest` requires exactly one registry
 * entry in the applied direction, so a fixture without it is not a plan the
 * marker will accept.
 */
const PLAN_ENTRIES: ManifestEntry[] = [
  { kind: "table", from: "comp_hero", to: "fg_hero" },
  { kind: "registry", from: "dynamic_components", to: "dynamic_field_groups" },
];
/** The hash has to describe the plan actually stored, so it is computed. */
const PLAN_IDENTITY = {
  registryHash: "slugs-1",
  manifestHash: hashManifest(PLAN_ENTRIES),
};

describe("field-group migration marker", () => {
  it("reads an absent marker as untouched legacy storage", async () => {
    const { meta } = createMeta();
    await expect(readMigrationState(meta)).resolves.toEqual({
      status: "settled",
      generation: "legacy",
      recorded: false,
    });
  });

  it("round-trips an in-flight run", async () => {
    const { meta } = createMeta();
    await beginMigration(meta, {
      direction: "up",
      migrationId: "run-1",
      plan: PLAN_IDENTITY,
      appliedManifest: PLAN_ENTRIES,
    });
    await expect(readMigrationState(meta)).resolves.toEqual({
      status: "migrating",
      direction: "up",
      migrationId: "run-1",
      step: 0,
      plan: PLAN_IDENTITY,
      appliedManifest: PLAN_ENTRIES,
    });
  });

  // Both halves of the plan identity survive a step being checked off; losing
  // either would leave a later resume unable to tell whether it still applies.
  it("preserves the plan identity across steps", async () => {
    const { meta } = createMeta();
    await beginMigration(meta, {
      direction: "up",
      migrationId: "run-1",
      plan: PLAN_IDENTITY,
      appliedManifest: PLAN_ENTRIES,
    });
    await advanceStep(meta, { migrationId: "run-1", step: 1 });
    await expect(readMigrationState(meta)).resolves.toMatchObject({
      plan: PLAN_IDENTITY,
      appliedManifest: PLAN_ENTRIES,
    });
  });

  // The writer holds itself to the reader's invariants. Writing an empty
  // identifier would succeed and then be rejected by the very next read,
  // turning a successful begin into an unavailable database.
  it.each([
    ["migrationId", { migrationId: "", registryHash: "s", manifestHash: "h" }],
    ["registryHash", { migrationId: "r", registryHash: "", manifestHash: "h" }],
    ["manifestHash", { migrationId: "r", registryHash: "s", manifestHash: "" }],
  ])("refuses to begin a run with an empty %s", async (_label, fields) => {
    const { meta, read } = createMeta();
    await expect(
      beginMigration(meta, {
        direction: "up",
        migrationId: fields.migrationId,
        plan: {
          registryHash: fields.registryHash,
          manifestHash: fields.manifestHash,
        },
        appliedManifest: PLAN_ENTRIES,
      })
    ).rejects.toThrowError(NextlyError);
    // Nothing may reach storage: a marker written here is exactly the
    // unreadable state the check exists to prevent.
    expect(read()).toBe(ABSENT);
    expect(meta.set).not.toHaveBeenCalled();
  });

  // The first write must land before any statement runs, because MySQL commits
  // DDL implicitly and a crash after the first rename would otherwise leave
  // renamed objects with nothing recording them.
  it("starts at step 0 so a crash before step 1 re-runs it", async () => {
    const { meta, read } = createMeta();
    await beginMigration(meta, {
      direction: "up",
      migrationId: "run-1",
      plan: PLAN_IDENTITY,
      appliedManifest: PLAN_ENTRIES,
    });
    expect(read()).toMatchObject({ status: "migrating", step: 0 });
    expect(meta.set).toHaveBeenCalledWith(
      FIELD_GROUP_MIGRATION_KEY,
      expect.objectContaining({ version: MIGRATION_MARKER_VERSION })
    );
  });

  it("advances one step at a time", async () => {
    const { meta } = createMeta();
    await beginMigration(meta, {
      direction: "up",
      migrationId: "run-1",
      plan: PLAN_IDENTITY,
      appliedManifest: PLAN_ENTRIES,
    });
    await advanceStep(meta, { migrationId: "run-1", step: 1 });
    await advanceStep(meta, { migrationId: "run-1", step: 2 });
    await expect(readMigrationState(meta)).resolves.toMatchObject({ step: 2 });
  });

  // Skipping a step would record work that never ran; going backwards would
  // re-run a verified step under a stale assumption. Both mean the caller has
  // lost its place and should re-read rather than assert.
  it("refuses to skip or rewind", async () => {
    const { meta } = createMeta();
    await beginMigration(meta, {
      direction: "up",
      migrationId: "run-1",
      plan: PLAN_IDENTITY,
      appliedManifest: PLAN_ENTRIES,
    });
    await expect(
      advanceStep(meta, { migrationId: "run-1", step: 2 })
    ).rejects.toThrowError(NextlyError);
    await advanceStep(meta, { migrationId: "run-1", step: 1 });
    await expect(
      advanceStep(meta, { migrationId: "run-1", step: 1 })
    ).rejects.toThrowError(NextlyError);
  });

  // The bound is enforced on the way in as well as on the way out. Recording a
  // position the next read would reject as corrupt is worse than refusing to
  // advance, because it leaves the marker with no way forward at all.
  it("refuses to record a step past the highest readable position", async () => {
    const { meta, read } = createMeta({
      version: MIGRATION_MARKER_VERSION,
      status: "migrating",
      direction: "up",
      migrationId: "run-1",
      step: MAX_MIGRATION_STEP,
      registryHash: "slugs-1",
      manifestHash: PLAN_IDENTITY.manifestHash,
      appliedManifest: PLAN_ENTRIES,
    });
    const before = read();
    await expect(
      advanceStep(meta, { migrationId: "run-1", step: MAX_MIGRATION_STEP + 1 })
    ).rejects.toThrowError(NextlyError);
    // The refusal must leave the marker exactly as it was; a partial write here
    // is the corruption the bound exists to prevent.
    expect(read()).toEqual(before);
  });

  it("refuses a step belonging to a different run", async () => {
    const { meta } = createMeta();
    await beginMigration(meta, {
      direction: "up",
      migrationId: "run-1",
      plan: PLAN_IDENTITY,
      appliedManifest: PLAN_ENTRIES,
    });
    await expect(
      advanceStep(meta, { migrationId: "run-2", step: 1 })
    ).rejects.toThrowError(NextlyError);
  });

  it("settles at a generation once verification has passed", async () => {
    const { meta } = createMeta();
    await beginMigration(meta, {
      direction: "up",
      migrationId: "run-1",
      plan: PLAN_IDENTITY,
      appliedManifest: PLAN_ENTRIES,
    });
    await settleMigration(meta, {
      generation: "field-groups-v2",
      appliedManifest: [
        { kind: "table", from: "comp_hero", to: "fg_hero" },
        {
          kind: "registry",
          from: "dynamic_components",
          to: "dynamic_field_groups",
        },
      ],
    });
    await expect(readMigrationState(meta)).resolves.toMatchObject({
      status: "settled",
      generation: "field-groups-v2",
      recorded: true,
    });
  });

  // The plan must survive the transition out of `settled` and every step after
  // it. Writing it only at settlement loses it the moment a rollback starts.
  it("carries the applied plan through a run and its steps", async () => {
    const { meta } = createMeta();
    // A down run records the plan that was APPLIED, not its inverse: the record
    // says what happened, and the rollback inverts it when it executes.
    const applied = [
      {
        kind: "registry" as const,
        from: "dynamic_components",
        to: "dynamic_field_groups",
      },
      { kind: "table" as const, from: "comp_hero", to: "fg_hero" },
      {
        kind: "column" as const,
        from: "_component_type",
        to: "_field_group_type",
        table: "fg_hero",
      },
    ];
    await beginMigration(meta, {
      direction: "down",
      migrationId: "run-1",
      // The recorded hash has to describe the plan being stored, so it is
      // computed from that plan rather than reused from another fixture.
      plan: { registryHash: "slugs-1", manifestHash: hashManifest(applied) },
      appliedManifest: applied,
    });
    await expect(readMigrationState(meta)).resolves.toMatchObject({
      status: "migrating",
      appliedManifest: applied,
    });

    await advanceStep(meta, { migrationId: "run-1", step: 1 });
    await expect(readMigrationState(meta)).resolves.toMatchObject({
      status: "migrating",
      step: 1,
      appliedManifest: applied,
    });
  });

  // Every plan renames the registry exactly once, so a recorded plan without
  // that entry is a fragment. Reversing it would restore the data tables and
  // leave the registry migrated -- a state no direction can then interpret.
  it.each([
    ["an empty list", []],
    [
      "a list with no registry rename",
      [{ kind: "table" as const, from: "fg_a", to: "comp_a" }],
    ],
    [
      "a registry entry that renames something else",
      [{ kind: "registry" as const, from: "x", to: "y" }],
    ],
    [
      // The inverse of an applied plan is not a record of applied work. Storing
      // it would let a rollback invert it twice and migrate forward.
      "a pre-inverted registry entry",
      [
        {
          kind: "registry" as const,
          from: "dynamic_field_groups",
          to: "dynamic_components",
        },
      ],
    ],
    [
      "a list renaming the registry twice",
      [
        {
          kind: "registry" as const,
          from: "dynamic_components",
          to: "dynamic_field_groups",
        },
        {
          kind: "registry" as const,
          from: "dynamic_field_groups",
          to: "dynamic_components",
        },
      ],
    ],
  ])("refuses a recorded plan that is %s", async (_label, appliedManifest) => {
    const { meta } = createMeta({
      version: MIGRATION_MARKER_VERSION,
      status: "settled",
      generation: "field-groups-v2",
      appliedManifest,
    });
    await expect(readMigrationState(meta)).rejects.toThrowError(NextlyError);
  });

  // A plan built by the manifest always satisfies that invariant, so the
  // round-trip has to keep working.
  it("accepts a plan built by the manifest builder", async () => {
    const { meta } = createMeta();
    const built = buildMigrationManifest([
      { slug: "hero", tableName: "comp_hero", hasCompanion: false },
    ]);
    await settleMigration(meta, {
      generation: "field-groups-v2",
      appliedManifest: built.entries,
    });
    await expect(readMigrationState(meta)).resolves.toMatchObject({
      appliedManifest: built.entries,
    });
  });

  // The writer holds itself to the reader's rules. Writing a plan the next read
  // refuses would strand a run after its first step had already committed.
  it.each([
    ["an empty source", { kind: "table" as const, from: "", to: "fg_a" }],
    ["an empty target", { kind: "table" as const, from: "comp_a", to: "" }],
    [
      "a column with no table",
      {
        kind: "column" as const,
        from: "_component_type",
        to: "_field_group_type",
      },
    ],
  ])("refuses to begin a rollback with %s in the plan", async (_l, entry) => {
    const { meta, read } = createMeta();
    await expect(
      beginMigration(meta, {
        direction: "down",
        migrationId: "run-1",
        // A valid identity, so the refusal is attributable to the bad entry
        // rather than to the identity check that runs before it.
        plan: { registryHash: "s", manifestHash: "h" },
        // Otherwise valid: the registry entry is present, so the refusal is
        // attributable to the bad entry rather than to a missing registry.
        appliedManifest: [
          {
            kind: "registry" as const,
            from: "dynamic_components",
            to: "dynamic_field_groups",
          },
          entry,
        ],
      })
    ).rejects.toThrowError(NextlyError);
    expect(read()).toBe(ABSENT);
  });

  it("refuses to settle with a plan its own reader would reject", async () => {
    const { meta, read } = createMeta();
    await expect(
      settleMigration(meta, {
        generation: "field-groups-v2",
        appliedManifest: [
          {
            kind: "registry",
            from: "dynamic_components",
            to: "dynamic_field_groups",
          },
          { kind: "table", from: "comp_a", to: "" },
        ],
      })
    ).rejects.toThrowError(NextlyError);
    expect(read()).toBe(ABSENT);
  });

  // A column rename is addressed through its table, so an entry without one
  // cannot be executed or reversed.
  it("refuses a recorded column entry that names no table", async () => {
    const { meta } = createMeta({
      version: MIGRATION_MARKER_VERSION,
      status: "settled",
      generation: "field-groups-v2",
      appliedManifest: [
        {
          kind: "registry",
          from: "dynamic_components",
          to: "dynamic_field_groups",
        },
        { kind: "column", from: "_component_type", to: "_field_group_type" },
      ],
    });
    await expect(readMigrationState(meta)).rejects.toThrowError(NextlyError);
  });

  // A rollback reverses a persisted plan, so the plan has to survive
  // settlement. Deriving the reverse is impossible: nothing in the database
  // says which `fg_*` names this migration created.
  it("keeps the applied plan through settlement", async () => {
    const { meta } = createMeta();
    const applied = [
      { kind: "table" as const, from: "comp_hero", to: "fg_hero" },
      {
        kind: "column" as const,
        from: "_component_type",
        to: "_field_group_type",
        table: "fg_hero",
      },
      {
        kind: "registry" as const,
        from: "dynamic_components",
        to: "dynamic_field_groups",
      },
    ];
    await settleMigration(meta, {
      generation: "field-groups-v2",
      appliedManifest: applied,
    });
    await expect(readMigrationState(meta)).resolves.toMatchObject({
      status: "settled",
      generation: "field-groups-v2",
      appliedManifest: applied,
    });
  });

  // Settling back at `legacy` ends a reversal, so there is nothing left to
  // reverse and no plan to carry. The v2 case cannot be settled this way: the
  // type does not allow it.
  it("settles at legacy without a plan", async () => {
    const { meta } = createMeta();
    await settleMigration(meta, { generation: "legacy" });
    const state = await readMigrationState(meta);
    expect(state).toMatchObject({ status: "settled", generation: "legacy" });
    expect(
      (state as { appliedManifest?: unknown }).appliedManifest
    ).toBeUndefined();
  });

  // A rollback acts on this plan, so an unreadable one must refuse rather than
  // revert some objects and silently leave others migrated.
  it.each([
    ["not a list", "nonsense"],
    ["a non-object entry", [42]],
    ["an entry with no known kind", [{ kind: "whatever", from: "a", to: "b" }]],
    ["an entry with no source", [{ kind: "table", to: "b" }]],
    ["an entry with no target", [{ kind: "table", from: "a" }]],
    [
      "an entry with an invalid table",
      [{ kind: "column", from: "a", to: "b", table: 7 }],
    ],
  ])("refuses a recorded plan that is %s", async (_label, appliedManifest) => {
    const { meta } = createMeta({
      version: MIGRATION_MARKER_VERSION,
      status: "settled",
      generation: "field-groups-v2",
      appliedManifest,
    });
    await expect(readMigrationState(meta)).rejects.toThrowError(NextlyError);
  });

  // A marker that exists but cannot be read must never degrade to "absent":
  // that would restart a run which may already have renamed objects.
  it.each([
    ["not an object", "nonsense"],
    [
      "unknown version",
      { version: 99, status: "settled", generation: "legacy" },
    ],
    ["unknown generation", { version: 1, status: "settled", generation: "?" }],
    ["unknown status", { version: 1, status: "elsewhere" }],
    [
      "in-flight without a direction",
      {
        version: 1,
        status: "migrating",
        migrationId: "r",
        step: 0,
        manifestHash: "h",
      },
    ],
    [
      "in-flight without an id",
      {
        version: 1,
        status: "migrating",
        direction: "up",
        step: 0,
        manifestHash: "h",
      },
    ],
    [
      "in-flight with a fractional step",
      {
        version: 1,
        status: "migrating",
        direction: "up",
        migrationId: "r",
        step: 1.5,
        manifestHash: "h",
      },
    ],
    [
      "in-flight without a manifest hash",
      {
        version: 1,
        status: "migrating",
        direction: "up",
        migrationId: "r",
        step: 0,
        registryHash: "s",
      },
    ],
    [
      "in-flight without a registry identity hash",
      {
        version: 1,
        status: "migrating",
        direction: "up",
        migrationId: "r",
        step: 0,
        manifestHash: "h",
      },
    ],
    [
      // At 2^53 `step + 1 === step`, so a resume would recompute the same
      // position forever. A number that cannot be incremented is not a
      // position, whatever `Number.isInteger` says about it.
      "in-flight with a step beyond the safe integer range",
      {
        version: 1,
        status: "migrating",
        direction: "up",
        migrationId: "r",
        step: Number.MAX_SAFE_INTEGER + 1,
        manifestHash: "h",
        planHash: "p",
      },
    ],
    [
      // The ceiling itself is refused too. Accepting it would hand a resume the
      // step above, which increments to itself, gets recorded, and is then
      // rejected by the next read -- a marker with no way forward.
      "in-flight at the safe integer ceiling",
      {
        version: 1,
        status: "migrating",
        direction: "up",
        migrationId: "r",
        step: Number.MAX_SAFE_INTEGER,
        manifestHash: "h",
        planHash: "p",
      },
    ],
    [
      "in-flight without a plan hash",
      {
        version: 1,
        status: "migrating",
        direction: "up",
        migrationId: "r",
        step: 0,
        manifestHash: "h",
      },
    ],
  ])("refuses a corrupt marker: %s", async (_label, stored) => {
    const { meta } = createMeta(stored);
    await expect(readMigrationState(meta)).rejects.toThrowError(NextlyError);
  });

  it("reports a corrupt marker as unavailable rather than absent", async () => {
    const { meta } = createMeta("nonsense");
    await expect(readMigrationState(meta)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  // A row whose value is SQL NULL, and a row holding the JSON literal `null`,
  // both decode to `null`. Neither is an absent marker: we wrote a row, so a
  // run started, and reading it as "untouched" would restart a migration that
  // may already have renamed objects.
  it("refuses a marker row that exists but carries no value", async () => {
    const { meta } = createMeta(null);
    await expect(readMigrationState(meta)).rejects.toThrowError(NextlyError);
    await expect(readMigrationState(meta)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("still reads a genuinely absent row as untouched legacy storage", async () => {
    const { meta } = createMeta();
    await expect(readMigrationState(meta)).resolves.toEqual({
      status: "settled",
      generation: "legacy",
      recorded: false,
    });
  });
});

// Step numbers index into a plan. Resuming step N against a plan that is no
// longer the same plan would rename or verify the wrong thing, and there is no
// way to reconcile the two, so any mismatch is refused outright.
describe("field-group migration plan guard", () => {
  const PLAN = { manifestHash: "hash-1", planHash: "plan-1" };

  function refusalFrom(current: {
    manifestHash: string;
    planHash: string;
  }): NextlyError {
    try {
      assertPlanUnchanged({ recorded: PLAN, current });
    } catch (error) {
      if (NextlyError.is(error)) return error;
      expect.fail(`expected a NextlyError, received ${String(error)}`);
    }
    expect.fail("expected a refusal, but the call returned normally");
  }

  it("allows a resume whose plan is unchanged", () => {
    expect(() =>
      assertPlanUnchanged({ recorded: PLAN, current: { ...PLAN } })
    ).not.toThrow();
  });

  // The application's schema moved: step N now names different objects.
  it("refuses a resume whose field group set changed", () => {
    const refusal = refusalFrom({ ...PLAN, registryHash: "slugs-2" });
    expect(refusal.code).toBe("SERVICE_UNAVAILABLE");
    expect(refusal.logContext?.reason).toMatch(/set of field groups changed/);
  });

  // A field group added or removed mid-run is storage the recorded plan never
  // mentions, which is the whole reason this comparison exists.
  it("accepts a resume whose field group set is unchanged", () => {
    expect(() =>
      assertPlanUnchanged({ recorded: PLAN, current: { ...PLAN } })
    ).not.toThrow();
  });

  // The plan itself is read back rather than rebuilt, so a rename that has
  // already committed changes table names without changing the set of slugs.
  // Comparing names here would refuse every resume past the first step.
  it("does not compare anything that a committed rename would change", () => {
    expect(() =>
      assertPlanUnchanged({
        recorded: PLAN,
        current: { ...PLAN, manifestHash: "a-different-plan-hash" },
      })
    ).not.toThrow();
  });
});

describe("the persisted plan is the resume's authority", () => {
  // The plan is read back rather than rebuilt, so its integrity on read is the
  // only thing standing between a corrupted blob and a run that executes it.
  it("refuses a plan that does not match its recorded hash", async () => {
    const { meta } = createMeta({
      version: 1,
      status: "migrating",
      direction: "up",
      migrationId: "run-1",
      step: 0,
      registryHash: "slugs-1",
      manifestHash: "a-hash-of-something-else",
      appliedManifest: PLAN_ENTRIES,
    });
    await expect(readMigrationState(meta)).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        /does not match its recorded hash/.test(
          String(error.logContext?.reason)
        )
    );
  });

  // A run in flight cannot proceed without the plan it is executing, in either
  // direction, so an absent one is corruption rather than an optional field.
  it.each(["up", "down"] as const)(
    "refuses an in-flight %s marker carrying no plan",
    async direction => {
      const { meta } = createMeta({
        version: 1,
        status: "migrating",
        direction,
        migrationId: "run-1",
        step: 0,
        registryHash: "slugs-1",
        manifestHash: PLAN_IDENTITY.manifestHash,
      });
      await expect(readMigrationState(meta)).rejects.toSatisfy(
        error =>
          NextlyError.is(error) &&
          /carries no plan/.test(String(error.logContext?.reason))
      );
    }
  );

  // The writer holds itself to the reader's invariant: recording a hash that
  // describes a different plan would make every later read refuse, stranding a
  // run that had already begun.
  it("refuses to begin a run whose recorded hash describes another plan", async () => {
    const { meta, read } = createMeta();
    await expect(
      beginMigration(meta, {
        direction: "up",
        migrationId: "run-1",
        plan: { registryHash: "slugs-1", manifestHash: "not-this-plan" },
        appliedManifest: PLAN_ENTRIES,
      })
    ).rejects.toThrowError(NextlyError);
    expect(read()).toBe(ABSENT);
  });

  it("round-trips the plan a run is executing", async () => {
    const { meta } = createMeta();
    await beginMigration(meta, {
      direction: "up",
      migrationId: "run-1",
      plan: PLAN_IDENTITY,
      appliedManifest: PLAN_ENTRIES,
    });
    await expect(readMigrationState(meta)).resolves.toMatchObject({
      status: "migrating",
      appliedManifest: PLAN_ENTRIES,
      plan: PLAN_IDENTITY,
    });
  });
});
