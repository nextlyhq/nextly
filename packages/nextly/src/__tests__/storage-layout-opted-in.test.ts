/**
 * A file written for per-language storage (`perLanguageStorageSuite()`) runs `nextly migrate` as
 * every installation does, its localisation data steps included: the harness leaves them out only
 * for a file on the earlier layout (`migrateDataStepsView`). The plausible broken harness takes
 * them out for every file, so no suite of the upgrade would ever run them.
 */
import { describe, expect, it } from "vitest";

import {
  LOCALISATION_DATA_STEPS,
  MIGRATE_DATA_STEPS,
} from "../cli/commands/upgrade-steps";
import { perLanguageStorageEnabled } from "../domains/i18n/per-language-storage";

import { perLanguageStorageSuite } from "./storage-layout";

perLanguageStorageSuite();

describe("`nextly migrate`'s data steps in a file on per-language storage", () => {
  it("include every localisation step", () => {
    expect(perLanguageStorageEnabled()).toBe(true);
    expect(LOCALISATION_DATA_STEPS.length).toBeGreaterThan(0);
    for (const step of LOCALISATION_DATA_STEPS) {
      expect(MIGRATE_DATA_STEPS).toContain(step);
    }
  });
});
