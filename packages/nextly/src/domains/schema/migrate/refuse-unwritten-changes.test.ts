/**
 * Whether a migration with a snapshot applied after the registry record's point, by the order the
 * migrations run. Base names begin with their timestamp, so they sort in that order. A point later
 * than the newest snapshot is a migration written without one (the per-language table a schema
 * change creates or extends, written beside it): it records nothing the record does not, so the
 * record's own permissions still hold. The plausible broken rule, comparing names for equality,
 * reads every such point as a newer snapshot and misses a permission removed without a migration.
 */
import { describe, expect, it } from "vitest";

import { snapshotAppliedSince } from "./refuse-unwritten-changes";

const ONE = "20261111_120005_000_one";
const ONE_LOCALIZATION = "20261111_120005_001_create_localization_fr-posts";
const TWO = "20261111_120007_000_two";

describe("snapshotAppliedSince", () => {
  it("is false with no snapshot at all", () => {
    expect(snapshotAppliedSince(null, null)).toBe(false);
    expect(snapshotAppliedSince(ONE, null)).toBe(false);
  });

  it("is true for a snapshot and no point, the record written before any migration", () => {
    expect(snapshotAppliedSince(null, ONE)).toBe(true);
  });

  it("is false where the point is the newest snapshot's own migration", () => {
    expect(snapshotAppliedSince(ONE, ONE)).toBe(false);
  });

  it("is false where the point is later than the newest snapshot, a migration written without one", () => {
    expect(snapshotAppliedSince(ONE_LOCALIZATION, ONE)).toBe(false);
  });

  it("is true where the newest snapshot is later than the point", () => {
    expect(snapshotAppliedSince(ONE, TWO)).toBe(true);
    expect(snapshotAppliedSince(ONE_LOCALIZATION, TWO)).toBe(true);
  });
});
