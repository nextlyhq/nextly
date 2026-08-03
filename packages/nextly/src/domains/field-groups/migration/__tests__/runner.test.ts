import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { MetaService } from "../../../meta/services/meta-service";
import { hashManifest, type ManifestEntry } from "../manifest";
import { runMigrationSteps, type MigrationStep } from "../runner";
import type { MigrationSession } from "../session";
import { MIGRATION_MARKER_VERSION } from "../state";

const SESSION = {
  dialect: "postgresql",
  inTransaction: async <T>(work: (ctx: never) => Promise<T>) =>
    work(undefined as never),
} as unknown as MigrationSession;

function step(
  id: string,
  events: string[],
  options: {
    verifies?: boolean;
    throws?: boolean;
    recordsProgress?: boolean;
  } = {}
): MigrationStep {
  return {
    id,
    ...(options.recordsProgress === undefined
      ? {}
      : { recordsProgress: options.recordsProgress }),
    run: vi.fn(async () => {
      events.push(`run:${id}`);
      if (options.throws) {
        throw NextlyError.internal({ logContext: { reason: `boom:${id}` } });
      }
    }),
    verify: vi.fn(async () => {
      events.push(`verify:${id}`);
      return options.verifies !== false;
    }),
  };
}

// `advanceStep` reads the marker before writing, so the fake has to behave like
// The marker carries the plan it is executing, and the read verifies that plan
// against its recorded hash, so a stand-in marker has to carry both.
const MARKER_PLAN: ManifestEntry[] = [
  { kind: "registry", from: "dynamic_components", to: "dynamic_field_groups" },
];
const MARKER_PLAN_HASH = hashManifest(MARKER_PLAN);

// a real marker rather than just recording calls.
function markerMeta(events: string[], migrationId: string) {
  let stored: Record<string, unknown> = {
    version: MIGRATION_MARKER_VERSION,
    status: "migrating",
    direction: "up",
    migrationId,
    step: 0,
    registryHash: "s",
    manifestHash: MARKER_PLAN_HASH,
    appliedManifest: MARKER_PLAN,
  };
  return {
    getEntry: vi.fn(async () => ({ present: true, value: stored })),
    get: vi.fn(async () => stored),
    set: vi.fn(async (_key: string, value: unknown) => {
      const marker = value as { step: number };
      events.push(`record:${marker.step}`);
      stored = value as Record<string, unknown>;
    }),
  } as unknown as MetaService;
}

describe("field-group migration runner", () => {
  it("runs, verifies, then records — in that order, for every step", async () => {
    const events: string[] = [];
    const meta = markerMeta(events, "run-1");
    await runMigrationSteps({
      session: SESSION,
      meta,
      migrationId: "run-1",
      steps: [step("a", events), step("b", events)],
      fromStep: 1,
    });
    expect(events).toEqual([
      "run:a",
      "verify:a",
      "record:1",
      "run:b",
      "verify:b",
      "record:2",
    ]);
  });

  // Recording before verifying would let a step that silently did nothing be
  // marked done and skipped forever after.
  it("does not record a step whose postcondition fails", async () => {
    const events: string[] = [];
    const meta = markerMeta(events, "run-1");
    await expect(
      runMigrationSteps({
        session: SESSION,
        meta,
        migrationId: "run-1",
        steps: [step("a", events, { verifies: false })],
        fromStep: 1,
      })
    ).rejects.toThrowError(NextlyError);
    expect(events).toEqual(["run:a", "verify:a"]);
    expect(meta.set).not.toHaveBeenCalled();
  });

  // A failed postcondition means the database is not in the state the plan
  // believes, and every later step is written against that belief.
  it("stops at the failing step rather than continuing", async () => {
    const events: string[] = [];
    const meta = markerMeta(events, "run-1");
    await expect(
      runMigrationSteps({
        session: SESSION,
        meta,
        migrationId: "run-1",
        steps: [
          step("a", events),
          step("b", events, { verifies: false }),
          step("c", events),
        ],
        fromStep: 1,
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(events).not.toContain("run:c");
  });

  it("names the step that failed, so a refusal points somewhere", async () => {
    const events: string[] = [];
    const meta = markerMeta(events, "run-1");
    try {
      await runMigrationSteps({
        session: SESSION,
        meta,
        migrationId: "run-1",
        steps: [step("rename-registry", events, { verifies: false })],
        fromStep: 1,
      });
      expect.fail("expected a refusal");
    } catch (error) {
      expect((error as NextlyError).logContext?.step).toBe("rename-registry");
    }
  });

  // A resume starts at the step after the last verified one and must not
  // re-run work that was already checked off.
  it("resumes without re-running verified steps", async () => {
    const events: string[] = [];
    const meta = markerMeta(events, "run-1");
    // The marker already reports step 1 done.
    await meta.set("k", {
      version: MIGRATION_MARKER_VERSION,
      status: "migrating",
      direction: "up",
      migrationId: "run-1",
      step: 1,
      registryHash: "s",
      manifestHash: MARKER_PLAN_HASH,
      appliedManifest: MARKER_PLAN,
    });
    events.length = 0;
    await runMigrationSteps({
      session: SESSION,
      meta,
      migrationId: "run-1",
      steps: [step("a", events), step("b", events)],
      fromStep: 2,
    });
    expect(events).not.toContain("run:a");
    expect(events).toEqual(["run:b", "verify:b", "record:2"]);
  });

  // Every step already done is a legitimate resume position: the run finished
  // its steps but crashed before settling the marker.
  it("accepts a resume position one past the last step and does nothing", async () => {
    const events: string[] = [];
    const meta = markerMeta(events, "run-1");
    await runMigrationSteps({
      session: SESSION,
      meta,
      migrationId: "run-1",
      steps: [step("a", events), step("b", events)],
      fromStep: 3,
    });
    expect(events).toEqual([]);
  });

  // Further past the end than that means the marker and the plan disagree
  // about how much work exists, which no amount of running can reconcile.
  it("refuses a resume position beyond the end of the plan", async () => {
    const events: string[] = [];
    const meta = markerMeta(events, "run-1");
    await expect(
      runMigrationSteps({
        session: SESSION,
        meta,
        migrationId: "run-1",
        steps: [step("a", events)],
        fromStep: 4,
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(events).toEqual([]);
  });

  it.each([0, -1, 1.5])(
    "refuses a nonsensical resume position: %s",
    async pos => {
      const events: string[] = [];
      const meta = markerMeta(events, "run-1");
      await expect(
        runMigrationSteps({
          session: SESSION,
          meta,
          migrationId: "run-1",
          steps: [step("a", events)],
          fromStep: pos,
        })
      ).rejects.toThrowError(NextlyError);
      expect(events).toEqual([]);
    }
  );

  // A step that throws is not recorded either; the distinction between a throw
  // and a failed postcondition matters to an operator but not to the marker.
  it("does not record a step that threw", async () => {
    const events: string[] = [];
    const meta = markerMeta(events, "run-1");
    await expect(
      runMigrationSteps({
        session: SESSION,
        meta,
        migrationId: "run-1",
        steps: [step("a", events, { throws: true })],
        fromStep: 1,
      })
    ).rejects.toThrowError(NextlyError);
    expect(meta.set).not.toHaveBeenCalled();
  });
});

describe("steps that are gates rather than progress", () => {
  // 🔴 A gate's position is never written. Recording it would let the next run
  // step over the check, which is the opposite of what a check placed at the
  // end of a plan is for.
  it("runs and verifies a gate without recording it", async () => {
    const events: string[] = [];
    const meta = markerMeta(events, "run-1");
    await runMigrationSteps({
      session: SESSION,
      meta,
      migrationId: "run-1",
      steps: [
        step("a", events),
        step("gate", events, { recordsProgress: false }),
      ],
      fromStep: 1,
    });

    expect(events).toEqual([
      "run:a",
      "verify:a",
      "record:1",
      "run:gate",
      "verify:gate",
    ]);
  });

  // 🔴 The case a recorded gate makes unrecoverable. With the gate's position in
  // the marker, a resume would either step over the check or replay it and ask
  // `advanceStep` to write a position it already holds, which it refuses - so
  // every later attempt would fail identically. Left unrecorded, the marker
  // still points at the last real work and the resume simply re-enters the gate.
  it("re-enters the gate on a resume, having recorded nothing past the work", async () => {
    const events: string[] = [];
    const meta = markerMeta(events, "run-1");
    const steps = [
      step("a", events),
      step("gate", events, { recordsProgress: false }),
    ];
    await runMigrationSteps({
      session: SESSION,
      meta,
      migrationId: "run-1",
      steps,
      fromStep: 1,
    });

    events.length = 0;
    // The marker records one step, so this is exactly where a resume lands.
    await runMigrationSteps({
      session: SESSION,
      meta,
      migrationId: "run-1",
      steps,
      fromStep: 2,
    });

    expect(events).toEqual(["run:gate", "verify:gate"]);
  });

  // A gate records nothing, so a recording step after one would have to advance
  // the marker across the position it skipped, and `advanceStep` accepts only
  // exactly one more than it holds. Refused when the plan is handed over rather
  // than discovered as an unrecoverable marker after the first interruption.
  it("refuses a plan that records progress after a gate", async () => {
    const events: string[] = [];
    const meta = markerMeta(events, "run-1");
    await expect(
      runMigrationSteps({
        session: SESSION,
        meta,
        migrationId: "run-1",
        steps: [
          step("gate", events, { recordsProgress: false }),
          step("later", events),
        ],
        fromStep: 1,
      })
    ).rejects.toMatchObject({
      logContext: {
        reason: "a migration plan records progress after a gate",
        gate: "gate",
        step: "later",
      },
    });
    expect(events).toEqual([]);
  });
});
