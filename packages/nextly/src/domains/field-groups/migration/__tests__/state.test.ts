import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { MetaService } from "../../../meta/services/meta-service";
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
      plan: { manifestHash: "hash-1", planHash: "plan-1" },
    });
    await expect(readMigrationState(meta)).resolves.toEqual({
      status: "migrating",
      direction: "up",
      migrationId: "run-1",
      step: 0,
      plan: { manifestHash: "hash-1", planHash: "plan-1" },
    });
  });

  // Both halves of the plan identity survive a step being checked off; losing
  // either would leave a later resume unable to tell whether it still applies.
  it("preserves the plan identity across steps", async () => {
    const { meta } = createMeta();
    await beginMigration(meta, {
      direction: "up",
      migrationId: "run-1",
      plan: { manifestHash: "hash-1", planHash: "plan-1" },
    });
    await advanceStep(meta, { migrationId: "run-1", step: 1 });
    await expect(readMigrationState(meta)).resolves.toMatchObject({
      plan: { manifestHash: "hash-1", planHash: "plan-1" },
    });
  });

  // The writer holds itself to the reader's invariants. Writing an empty
  // identifier would succeed and then be rejected by the very next read,
  // turning a successful begin into an unavailable database.
  it.each([
    ["migrationId", { migrationId: "", manifestHash: "h", planHash: "p" }],
    ["manifestHash", { migrationId: "r", manifestHash: "", planHash: "p" }],
    ["planHash", { migrationId: "r", manifestHash: "h", planHash: "" }],
  ])("refuses to begin a run with an empty %s", async (_label, fields) => {
    const { meta, read } = createMeta();
    await expect(
      beginMigration(meta, {
        direction: "up",
        migrationId: fields.migrationId,
        plan: {
          manifestHash: fields.manifestHash,
          planHash: fields.planHash,
        },
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
      plan: { manifestHash: "hash-1", planHash: "plan-1" },
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
      plan: { manifestHash: "hash-1", planHash: "plan-1" },
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
      plan: { manifestHash: "hash-1", planHash: "plan-1" },
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
      manifestHash: "hash-1",
      planHash: "plan-1",
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
      plan: { manifestHash: "hash-1", planHash: "plan-1" },
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
      plan: { manifestHash: "hash-1", planHash: "plan-1" },
    });
    await settleMigration(meta, {
      generation: "field-groups-v2",
      appliedManifest: [{ kind: "table", from: "comp_hero", to: "fg_hero" }],
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
    const applied = [
      { kind: "table" as const, from: "fg_hero", to: "comp_hero" },
      {
        kind: "column" as const,
        from: "_field_group_type",
        to: "_component_type",
        table: "fg_hero",
      },
    ];
    await beginMigration(meta, {
      direction: "down",
      migrationId: "run-1",
      plan: { manifestHash: "hash-1", planHash: "plan-1" },
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
        plan: { manifestHash: "h", planHash: "p" },
        appliedManifest: [entry],
      })
    ).rejects.toThrowError(NextlyError);
    expect(read()).toBe(ABSENT);
  });

  it("refuses to settle with a plan its own reader would reject", async () => {
    const { meta, read } = createMeta();
    await expect(
      settleMigration(meta, {
        generation: "field-groups-v2",
        appliedManifest: [{ kind: "table", from: "comp_a", to: "" }],
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
        planHash: "p",
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
  it("refuses a resume whose object map changed", () => {
    const refusal = refusalFrom({ ...PLAN, manifestHash: "hash-2" });
    expect(refusal.code).toBe("SERVICE_UNAVAILABLE");
    expect(refusal.logContext?.reason).toMatch(/object map changed/);
  });

  // Nextly itself was upgraded and its steps were added, removed or reordered.
  // The database's own objects are untouched, so the manifest hash still
  // matches; only the plan hash catches this, and without it a resume would
  // continue at a step number that now means a different operation.
  it("refuses a resume whose step list changed under an unchanged object map", () => {
    const refusal = refusalFrom({ ...PLAN, planHash: "plan-2" });
    expect(refusal.code).toBe("SERVICE_UNAVAILABLE");
    expect(refusal.logContext?.reason).toMatch(/step list changed/);
  });

  // The two causes are reported separately because they send an operator to
  // different places: their own schema history, or the Nextly upgrade.
  it("names which half of the plan moved", () => {
    expect(
      refusalFrom({ ...PLAN, manifestHash: "hash-2" }).logContext?.reason
    ).not.toEqual(
      refusalFrom({ ...PLAN, planHash: "plan-2" }).logContext?.reason
    );
  });
});
