// The prebuilt static drizzle v2 relations per dialect (no dynamic
// edges). Runtime code should prefer SchemaRegistry.getRelations(),
// which layers dynamic-entity edges on top; this helper serves early
// boot paths and BaseService's fallback. Lives in its own module (not
// database/index) so test suites that vi.mock the database barrel
// don't have to know about it.

import type { AnyRelations } from "drizzle-orm";

import { loadedRelations } from "./dialect-tables";

/**
 * The relations of the loaded dialect, which `createAdapter` loads.
 *
 * No silent fallback: serving another dialect's relations (whose edges close
 * over that dialect's table objects) fails far from the cause with confusing
 * query errors. An unknown or undefined dialect, or one not loaded yet, means
 * the adapter isn't connected or reports a spelling this union doesn't know,
 * and fails at the source, naming which.
 */
export function getStaticRelations(dialect?: string): AnyRelations {
  return loadedRelations(dialect);
}
