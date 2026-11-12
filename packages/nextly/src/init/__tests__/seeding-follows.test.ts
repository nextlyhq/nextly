/**
 * Whether a start's own seeding is still to come, as the work it would repeat
 * asks it: a hold taken before a boot registers the services says so, until a
 * seeding run is asked for after it was taken. The request-path boot seeds
 * before its boot apply, so work that apply does after the seeding (an entity
 * a migration registered) must seed for itself rather than leave it to a run
 * that has already happened.
 */
import { afterEach, expect, it, vi } from "vitest";

import {
  bootSeedingFollows,
  holdBootSeeding,
  seedPermissionsAndRolePresets,
} from "../seed-permissions";

afterEach(() => {
  vi.unstubAllEnvs();
});

it("is due from the hold until a seeding run is asked for, and not after", async () => {
  // A build's seeding asks for a run and writes nothing, so no services are needed.
  vi.stubEnv("NEXT_PHASE", "phase-production-build");
  const release = holdBootSeeding();
  try {
    expect(bootSeedingFollows()).toBe(true);

    await seedPermissionsAndRolePresets();

    expect(bootSeedingFollows()).toBe(false);
  } finally {
    release();
  }
});

it("is due again for a hold taken after that run", async () => {
  vi.stubEnv("NEXT_PHASE", "phase-production-build");
  await seedPermissionsAndRolePresets();
  const release = holdBootSeeding();
  try {
    expect(bootSeedingFollows()).toBe(true);
  } finally {
    release();
  }
  expect(bootSeedingFollows()).toBe(false);
});
