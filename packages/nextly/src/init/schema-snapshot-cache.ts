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

// ---------------------------------------------------------------------------
// Short-lived cache for live-DB snapshots, keyed by the managed-table-name
// set. Separate from the desired-snapshot dequal cache above: that one
// short-circuits "nothing changed" applies, this one deduplicates the two
// `introspectLiveSnapshot` calls that would otherwise fire during a single
// apply (one in reload-config.ts, one inside PushSchemaPipeline.apply).
//
// Lifecycle: caller invokes `clearLiveSnapshots()` at the start of a logical
// apply boundary (reload-config.ts), `setLiveSnapshot()` after introspecting,
// and `getLiveSnapshot()` before it would introspect again. Keyed by a sorted
// table-name string so different managed-table sets don't collide.
// ---------------------------------------------------------------------------

interface LiveSnapshotCacheBag {
  __nextly_liveSnapshots?: Map<string, unknown>;
}

function keyOf(tableNames: readonly string[]): string {
  // Managed table names are normalised by the framework to [a-z0-9_], so
  // space is a safe separator (see resolveCollectionTableName). A pathological
  // user-supplied tableName containing a space can at worst collide and force
  // a cache miss — never a wrong snapshot, because cache use is also scoped
  // by the per-apply boundary.
  return [...tableNames].sort().join(" ");
}

function bag(): LiveSnapshotCacheBag {
  return globalThis as LiveSnapshotCacheBag;
}

/**
 * Returns the cached live-DB snapshot for the given set of managed table
 * names, or undefined if nothing is cached for that set. The set order
 * does not matter — table names are sorted internally before lookup.
 */
export function getLiveSnapshot(managedTableNames: readonly string[]): unknown {
  return bag().__nextly_liveSnapshots?.get(keyOf(managedTableNames));
}

/**
 * Stores a live-DB snapshot under the given set of managed table names.
 * Callers should pair this with `clearLiveSnapshots()` at the start of
 * their apply boundary so stale entries do not bleed across applies.
 */
export function setLiveSnapshot(
  managedTableNames: readonly string[],
  snapshot: unknown
): void {
  const b = bag();
  if (!b.__nextly_liveSnapshots) b.__nextly_liveSnapshots = new Map();
  b.__nextly_liveSnapshots.set(keyOf(managedTableNames), snapshot);
}

/**
 * Clears all cached live snapshots. Production callers invoke this at
 * the start of each logical apply boundary to prevent cross-apply leak.
 */
export function clearLiveSnapshots(): void {
  const b = bag();
  if (b.__nextly_liveSnapshots) b.__nextly_liveSnapshots.clear();
}
