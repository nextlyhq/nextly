import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { resolveStorageVerdict, type StorageProbe } from "../guard";
import type { MigrationState } from "../state";

const LEGACY: MigrationState = { status: "settled", generation: "legacy" };
const MIGRATED: MigrationState = {
  status: "settled",
  generation: "field-groups-v2",
};
const IN_FLIGHT: MigrationState = {
  status: "migrating",
  direction: "up",
  migrationId: "run-1",
  step: 4,
  manifestHash: "hash-1",
};

function probe(over: Partial<StorageProbe> = {}): StorageProbe {
  return {
    targetRegistryPresent: false,
    legacyRegistryPresent: true,
    ...over,
  };
}

// The guard is the only thing standing between a half-migrated database and a
// process that would read or rewrite it. Each case below is a state the pair of
// (marker, probe) can be found in; the ones with no safe interpretation must
// refuse rather than pick a side.
describe("field-group storage verdict", () => {
  it("uses legacy storage on an untouched database", () => {
    expect(resolveStorageVerdict({ state: LEGACY, probe: probe() })).toEqual({
      action: "use-legacy",
    });
  });

  it("uses migrated storage once the marker and the registry agree", () => {
    const verdict = resolveStorageVerdict({
      state: MIGRATED,
      probe: probe({
        targetRegistryPresent: true,
        legacyRegistryPresent: false,
      }),
    });
    expect(verdict).toEqual({ action: "use-field-groups-v2" });
  });

  // The host application shares this database. A table wearing our target name
  // that we have no record of creating is theirs until proven otherwise, and
  // renaming over it would destroy data Nextly does not own.
  it("refuses when a migrated-name object exists with no migration recorded", () => {
    expect(() =>
      resolveStorageVerdict({
        state: LEGACY,
        probe: probe({ targetRegistryPresent: true }),
      })
    ).toThrowError(NextlyError);
    // The narrative lives in logContext, not in the public message: the
    // envelope stays generic so a refusal never leaks storage internals.
    try {
      resolveStorageVerdict({
        state: LEGACY,
        probe: probe({ targetRegistryPresent: true }),
      });
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as NextlyError).logContext?.reason).toMatch(
        /no migration recorded it/
      );
    }
  });

  // A newer marker over an older database: a restore from backup that did not
  // also restore the marker. Serving would write post-migration names while
  // reading a legacy registry.
  it("refuses when the marker claims migrated but the registry is absent", () => {
    try {
      resolveStorageVerdict({ state: MIGRATED, probe: probe() });
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as NextlyError).logContext?.reason).toMatch(
        /migrated registry is absent/
      );
    }
  });

  // Resume from the step AFTER the last verified one; re-running a verified
  // step is wasteful, and skipping one leaves an object unrenamed.
  it("resumes at the step after the last verified one", () => {
    expect(resolveStorageVerdict({ state: IN_FLIGHT, probe: probe() })).toEqual(
      { action: "resume", step: 5 }
    );
  });

  // An interrupted run is interpretable only by the step list, whatever the
  // objects currently look like. The probe must not override the marker here.
  it("resumes regardless of what the probe finds", () => {
    for (const target of [true, false]) {
      expect(
        resolveStorageVerdict({
          state: IN_FLIGHT,
          probe: probe({ targetRegistryPresent: target }),
        })
      ).toEqual({ action: "resume", step: 5 });
    }
  });

  it("reports refusals as retryable-unavailable, not as a client error", () => {
    try {
      resolveStorageVerdict({
        state: LEGACY,
        probe: probe({ targetRegistryPresent: true }),
      });
      throw new Error("expected a refusal");
    } catch (error) {
      expect(NextlyError.is(error)).toBe(true);
      expect((error as NextlyError).code).toBe("SERVICE_UNAVAILABLE");
    }
  });
});
