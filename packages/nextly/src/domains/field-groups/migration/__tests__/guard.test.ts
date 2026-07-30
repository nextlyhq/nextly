import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { resolveStorageVerdict, type StorageProbe } from "../guard";
import type { ManifestEntry } from "../manifest";
import { MAX_MIGRATION_STEP } from "../state";
import type { MigratingState, MigrationState } from "../state";

// An untouched database: no marker was ever written.
const FRESH: MigrationState = {
  status: "settled",
  generation: "legacy",
  recorded: false,
};
// A marker that explicitly settled back at legacy, i.e. after a rollback.
const ROLLED_BACK: MigrationState = {
  status: "settled",
  generation: "legacy",
  recorded: true,
};
const MIGRATED: MigrationState = {
  status: "settled",
  generation: "field-groups-v2",
  recorded: true,
};
const IN_FLIGHT_PLAN: ManifestEntry[] = [
  { kind: "registry", from: "dynamic_components", to: "dynamic_field_groups" },
];
const IN_FLIGHT: MigratingState = {
  status: "migrating",
  direction: "up",
  migrationId: "run-1",
  step: 4,
  plan: { slugsHash: "slugs-1", manifestHash: "hash-1" },
  appliedManifest: IN_FLIGHT_PLAN,
};

function probe(over: Partial<StorageProbe> = {}): StorageProbe {
  return {
    targetRegistryPresent: false,
    legacyRegistryPresent: true,
    migratedObjects: null,
    ...over,
  };
}

/** A probe over a database whose migrated objects all checked out. */
function verifiedProbe(over: Partial<StorageProbe> = {}): StorageProbe {
  return probe({
    targetRegistryPresent: true,
    legacyRegistryPresent: false,
    migratedObjects: { complete: true },
    ...over,
  });
}

/**
 * Run something expected to refuse, and hand back the refusal to assert on.
 * Anything else -- returning, or throwing a different kind of error -- fails
 * the test where it happened rather than further down an assertion chain.
 */
function captureRefusal(run: () => unknown): NextlyError {
  try {
    run();
  } catch (error) {
    if (NextlyError.is(error)) return error;
    expect.fail(`expected a NextlyError, received ${String(error)}`);
  }
  expect.fail("expected a refusal, but the call returned normally");
}

// The guard is the only thing standing between a half-migrated database and a
// process that would read or rewrite it. Each case below is a state the pair of
// (marker, probe) can be found in; the ones with no safe interpretation must
// refuse rather than pick a side.
describe("field-group storage verdict", () => {
  it("uses legacy storage on an untouched database", () => {
    expect(resolveStorageVerdict({ state: FRESH, probe: probe() })).toEqual({
      action: "use-legacy",
    });
  });

  it("uses migrated storage once the marker, registry and objects all agree", () => {
    const verdict = resolveStorageVerdict({
      state: MIGRATED,
      probe: verifiedProbe(),
    });
    expect(verdict).toEqual({ action: "use-field-groups-v2" });
  });

  // A completed migration renames the legacy registry rather than copying it,
  // so finding both is a state the pair cannot explain: two tables claim to be
  // the registry, and a later rollback would rename onto an occupied name.
  it("refuses when both registries are present after a completed migration", () => {
    const refusal = captureRefusal(() =>
      resolveStorageVerdict({
        state: MIGRATED,
        probe: verifiedProbe({ legacyRegistryPresent: true }),
      })
    );
    expect(refusal.logContext?.reason).toMatch(/both the legacy and migrated/);
  });

  // The registry existing proves only that the registry exists. Serving on that
  // alone would read content out of data tables nobody checked for.
  it("refuses migrated storage that was never structurally verified", () => {
    const refusal = captureRefusal(() =>
      resolveStorageVerdict({
        state: MIGRATED,
        probe: verifiedProbe({ migratedObjects: null }),
      })
    );
    expect(refusal.logContext?.reason).toMatch(/not structurally verified/);
  });

  // A partial restore leaves the registry pointing at tables that are gone. The
  // read path turns a missing data table into an empty result, so without this
  // the site comes up serving blank content and reporting no error at all.
  it("refuses when objects the registry references are missing", () => {
    const refusal = captureRefusal(() =>
      resolveStorageVerdict({
        state: MIGRATED,
        probe: verifiedProbe({
          migratedObjects: { complete: false, missing: ["fg_hero"] },
        }),
      })
    );
    expect(refusal.logContext?.reason).toMatch(/missing or unmigrated/);
    // Naming what is missing is the point: an operator needs to know which
    // objects to restore, not merely that something is wrong.
    expect(refusal.logContext?.missing).toEqual(["fg_hero"]);
  });

  // The host application shares this database. A table wearing our target name
  // that we have no record of creating is theirs until proven otherwise, and
  // renaming over it would destroy data Nextly does not own.
  it("refuses when a migrated-name object exists with no migration recorded", () => {
    // The narrative lives in logContext, not in the public message: the
    // envelope stays generic so a refusal never leaks storage internals.
    const refusal = captureRefusal(() =>
      resolveStorageVerdict({
        state: FRESH,
        probe: probe({ targetRegistryPresent: true }),
      })
    );
    expect(refusal.logContext?.reason).toMatch(/no migration recorded it/);
  });

  // An untouched database has no registry yet and creating one is ordinary
  // first-run behaviour, so absence here is expected rather than suspicious.
  it("allows a fresh database with no registry at all", () => {
    expect(
      resolveStorageVerdict({
        state: FRESH,
        probe: probe({ legacyRegistryPresent: false }),
      })
    ).toEqual({ action: "use-legacy" });
  });

  // A marker that explicitly settled at legacy was written after a run that
  // left a registry behind, so its absence is unexplained. This is the mirror
  // of the migrated case: same shape of evidence, same refusal.
  it("refuses when a recorded legacy marker has no legacy registry", () => {
    const refusal = captureRefusal(() =>
      resolveStorageVerdict({
        state: ROLLED_BACK,
        probe: probe({ legacyRegistryPresent: false }),
      })
    );
    expect(refusal.logContext?.reason).toMatch(/legacy registry is absent/);
  });

  // The distinction only matters when the registry is missing; with one present
  // a rolled-back database is served exactly like a fresh one.
  it("serves a rolled-back database whose legacy registry survived", () => {
    expect(
      resolveStorageVerdict({ state: ROLLED_BACK, probe: probe() })
    ).toEqual({ action: "use-legacy" });
  });

  // A newer marker over an older database: a restore from backup that did not
  // also restore the marker. Serving would write post-migration names while
  // reading a legacy registry.
  it("refuses when the marker claims migrated but the registry is absent", () => {
    const refusal = captureRefusal(() =>
      resolveStorageVerdict({ state: MIGRATED, probe: probe() })
    );
    expect(refusal.logContext?.reason).toMatch(/migrated registry is absent/);
  });

  // Resume from the step AFTER the last verified one; re-running a verified
  // step is wasteful, and skipping one leaves an object unrenamed.
  it("resumes at the step after the last verified one", () => {
    expect(resolveStorageVerdict({ state: IN_FLIGHT, probe: probe() })).toEqual(
      {
        action: "resume",
        step: 5,
        direction: "up",
        migrationId: "run-1",
        plan: { slugsHash: "slugs-1", manifestHash: "hash-1" },
        appliedManifest: IN_FLIGHT_PLAN,
      }
    );
  });

  // Everything a resume needs travels with the verdict. Without the direction
  // it could run the wrong step list; without the id `advanceStep` rejects it;
  // without the plan it cannot tell whether the step still means what it meant.
  it("carries the interrupted run's full identity into the resume", () => {
    const verdict = resolveStorageVerdict({
      state: IN_FLIGHT,
      probe: probe(),
    });
    expect(verdict).toMatchObject({
      action: "resume",
      direction: IN_FLIGHT.direction,
      migrationId: IN_FLIGHT.migrationId,
      plan: IN_FLIGHT.plan,
    });
  });

  // A `down` run interrupted at step 4 is not an `up` run interrupted at step 4,
  // and the verdict is the only thing telling them apart. A rollback also cannot
  // derive the plan it is reversing, so that plan travels with the verdict.
  it("distinguishes an interrupted down run from an interrupted up run", () => {
    const applied = [
      { kind: "table" as const, from: "fg_hero", to: "comp_hero" },
    ];
    const down: MigratingState = {
      ...IN_FLIGHT,
      direction: "down",
      appliedManifest: applied,
    };
    expect(
      resolveStorageVerdict({ state: down, probe: probe() })
    ).toMatchObject({
      action: "resume",
      direction: "down",
      appliedManifest: applied,
    });
  });

  // The plan travels with the verdict in both directions, because neither can
  // rebuild it: a rollback has no other source for the names this migration
  // created, and an up resume cannot rebuild one once each rename has rewritten
  // its registry pointer.
  it.each(["up", "down"] as const)(
    "carries the recorded plan into a %s resume",
    direction => {
      const state: MigratingState = { ...IN_FLIGHT, direction };
      expect(resolveStorageVerdict({ state, probe: probe() })).toMatchObject({
        action: "resume",
        direction,
        appliedManifest: IN_FLIGHT.appliedManifest,
      });
    }
  );

  // An interrupted run is interpretable only by the step list, whatever the
  // objects currently look like. The probe must not override the marker here.
  it("resumes regardless of what the probe finds", () => {
    for (const target of [true, false]) {
      expect(
        resolveStorageVerdict({
          state: IN_FLIGHT,
          probe: probe({ targetRegistryPresent: target }),
        })
      ).toMatchObject({ action: "resume", step: 5 });
    }
  });

  // `advanceStep` will not record a position past the bound, so a resume from
  // the last recordable step could never check off the work it did. Better to
  // say so than to hand back a verdict that runs and then cannot be saved.
  it("refuses to resume from a position it could never advance past", () => {
    const stuck: MigratingState = { ...IN_FLIGHT, step: MAX_MIGRATION_STEP };
    const refusal = captureRefusal(() =>
      resolveStorageVerdict({ state: stuck, probe: probe() })
    );
    expect(refusal.logContext?.reason).toMatch(/cannot advance past/);
  });

  // One below the bound still resumes: the derived step is exactly the highest
  // recordable one, so the read, resume and write bounds line up.
  it("still resumes from the last position whose successor can be recorded", () => {
    const nearly: MigratingState = {
      ...IN_FLIGHT,
      step: MAX_MIGRATION_STEP - 1,
    };
    expect(
      resolveStorageVerdict({ state: nearly, probe: probe() })
    ).toMatchObject({ action: "resume", step: MAX_MIGRATION_STEP });
  });

  it("reports refusals as retryable-unavailable, not as a client error", () => {
    const refusal = captureRefusal(() =>
      resolveStorageVerdict({
        state: FRESH,
        probe: probe({ targetRegistryPresent: true }),
      })
    );
    expect(refusal.code).toBe("SERVICE_UNAVAILABLE");
  });
});
