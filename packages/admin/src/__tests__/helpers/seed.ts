/**
 * A finished demo-content seed, for tests that need the mutation to land.
 *
 * One fixture rather than one per suite: `SeedResult` is a wire shape, and a
 * copy in each file drifts from it on its own schedule.
 *
 * @module __tests__/helpers/seed
 */

import type { SeedResult } from "@admin/services/seedApi";

export function seedResult(warnings: string[] = []): SeedResult {
  return {
    message: "Demo content seeded.",
    summary: {
      rolesCreated: 3,
      usersCreated: 3,
      categoriesCreated: 5,
      tagsCreated: 8,
      postsCreated: 12,
      mediaUploaded: 14,
      mediaSkipped: 0,
      collectionsRegistered: 0,
      singlesRegistered: 0,
      permissionsSynced: 0,
    },
    warnings,
  };
}
