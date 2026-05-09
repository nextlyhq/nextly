/**
 * Schema-snapshot cache for the Phase 5 dequal short-circuit.
 *
 * What this is for: dev-mode HMR and boot-time drift-check both call
 * the schema-sync pipeline. When the user saves nextly.config.ts with
 * no real change (or restarts the server with no config diff), the
 * pipeline today still runs drizzle-kit's pushSchema, which introspects
 * the live DB, computes a diff, and possibly fires interactive TTY
 * rename prompts. All of that work is wasted when nothing actually
 * changed.
 *
 * The cache stores the most recently-pushed desired-schema snapshot.
 * Callers `dequal()` the current snapshot against the cached one; if
 * equal, they short-circuit and skip the pipeline.
 *
 * Storage choice — `globalThis`: matches the same pattern used by
 * `init.ts`'s Nextly singleton and `drizzle-kit-lazy.ts`'s module
 * cache. Surviving Turbopack HMR module re-execution is essential —
 * if the cache lived in a module-scoped variable, every HMR cycle
 * would clear it and the short-circuit would never fire.
 *
 * Snapshot shape — opaque: callers pass whatever structure represents
 * "the desired schema for the current pipeline run." For HMR this is
 * the full `DesiredSchema` (collections + singles + components). For
 * drift-check it's the same. Could be the raw drizzle-kit table object
 * too. Cache is shape-agnostic; dequal walks deeply.
 *
 * Reference: Payload's pushDevSchema pattern in
 * `packages/drizzle/src/utilities/pushDevSchema.ts` — same idea, same
 * storage choice (their `global._payload`).
 */

interface SchemaSnapshotCache {
  __nextly_prevSchemaSnapshot?: unknown;
}

const g = globalThis as SchemaSnapshotCache;

/**
 * Returns the cached snapshot, or undefined if nothing has been cached
 * yet. First call after a process boot returns undefined; subsequent
 * calls return whatever the most recent `setCachedSnapshot` stored.
 */
export function getCachedSnapshot(): unknown {
  return g.__nextly_prevSchemaSnapshot;
}

/**
 * Stores the snapshot. Overwrites any prior value. Callers should call
 * this ONLY after a successful pipeline apply — caching a snapshot
 * before the apply succeeds would skip future runs even if the apply
 * actually failed and the live DB is now out of sync.
 */
export function setCachedSnapshot(snapshot: unknown): void {
  g.__nextly_prevSchemaSnapshot = snapshot;
}

/**
 * Clears the cache. Test-only helper; production code never needs to
 * clear because the next successful apply will overwrite. Exported so
 * unit tests can reset between cases without leaking globalThis state.
 */
export function clearCachedSnapshot(): void {
  delete g.__nextly_prevSchemaSnapshot;
}
