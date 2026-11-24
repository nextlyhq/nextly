/**
 * The grandfather record: which preset roles held each collection's grants
 * when this site first ran a release in which new collections start closed
 * to the preset roles.
 *
 * The preset roles' grants are set by difference from their rules at every
 * development start and every `nextly migrate`. A release that changes the
 * rules so that a collection reaches a preset only once it is opened by name
 * would, set by difference, take every existing collection's grants from
 * Admin, Editor, Author and Viewer at the first run after the upgrade. So that
 * run first records, once, which presets held grants on each collection, and
 * the presets keep reaching those collections until the configuration says
 * otherwise (`auth/preset-reach`).
 *
 * Stored as one `nextly_meta` row, `{ collections: { [slug]: presetSlugs } }`,
 * written once and never changed after. A new install's first run finds no
 * preset role yet, so it records no collection: everything there starts
 * closed. Written with an insert that does nothing where another run wrote
 * the row first, and read back after, so two first runs at once agree on one
 * record.
 *
 * @module domains/meta/preset-grants-grandfathered
 */

import type { MetaService } from "./services/meta-service";

/** The `nextly_meta` key the record is stored under. */
const PRESET_GRANTS_GRANDFATHERED_KEY = "preset-grants-grandfathered";

/** What the record is read and written through. */
export interface GrandfatherRecordDeps {
  meta: Pick<MetaService, "get" | "insertIfAbsent">;
  /** Whether a preset role exists: a run of an earlier release made them. */
  presetRolesExist: () => Promise<boolean>;
  /**
   * By collection slug, the preset roles holding any of its permissions now.
   * Read only where no record exists yet, before any grant is set.
   */
  presetHoldings: () => Promise<ReadonlyMap<string, readonly string[]>>;
}

/**
 * The collections a stored value keeps open, with their presets. Anything
 * that is not the record's shape reads as no collection kept, never as every
 * collection kept: a damaged row closes, it does not open.
 */
function decodeRecord(raw: unknown): Map<string, readonly string[]> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return new Map();
    }
  }
  const kept = new Map<string, readonly string[]>();
  if (typeof value !== "object" || value === null) return kept;
  const { collections } = value as Record<string, unknown>;
  if (typeof collections !== "object" || collections === null) return kept;
  for (const [slug, presets] of Object.entries(collections)) {
    if (Array.isArray(presets)) {
      kept.set(
        slug,
        presets.filter((p): p is string => typeof p === "string")
      );
    }
  }
  return kept;
}

/**
 * The grandfather record, written first where this database has none: the
 * presets holding each collection's grants on a site an earlier release ran,
 * and no collection on a new install. Called before any preset grant is set,
 * the one time the two can be told apart.
 */
export async function grandfatheredPresetGrants(
  deps: GrandfatherRecordDeps
): Promise<Map<string, readonly string[]>> {
  const recorded = await deps.meta.get<unknown>(
    PRESET_GRANTS_GRANDFATHERED_KEY
  );
  if (recorded !== null) return decodeRecord(recorded);
  const collections: Record<string, string[]> = {};
  if (await deps.presetRolesExist()) {
    for (const [slug, presets] of await deps.presetHoldings()) {
      if (presets.length > 0) collections[slug] = [...presets].sort();
    }
  }
  await deps.meta.insertIfAbsent(PRESET_GRANTS_GRANDFATHERED_KEY, {
    collections,
  });
  // Read back: where another first run wrote the row first, its record stands.
  return decodeRecord(
    await deps.meta.get<unknown>(PRESET_GRANTS_GRANDFATHERED_KEY)
  );
}
