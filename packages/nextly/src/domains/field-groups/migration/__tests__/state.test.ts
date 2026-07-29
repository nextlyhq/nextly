import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { MetaService } from "../../../meta/services/meta-service";
import {
  advanceStep,
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
    await settleMigration(meta, "field-groups-v2");
    await expect(readMigrationState(meta)).resolves.toEqual({
      status: "settled",
      generation: "field-groups-v2",
    });
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
