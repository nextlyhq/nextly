/**
 * Reading a registry sync's report: which slugs actually LANDED.
 *
 * 🔴 `errors[]` is not that answer, and the gap is the whole reason this module
 * exists. Both registries push a slug onto `created` or `updated` BEFORE
 * awaiting the permission seeding that follows the write, and the catch around
 * that await appends to `errors`. So a slug can appear in BOTH lists, and when
 * it does the meaning is specific: the registry row was written and something
 * after it failed.
 *
 * Read as a refusal, such a slug is withheld from the widget sources and its
 * migration is never marked applied -- over metadata that is in fact current,
 * and with no later pass able to correct it, because every later pass reads the
 * same report the same way. The failure is silent and permanent.
 *
 * One implementation because three callers ask it: the metadata-only reload,
 * the post-DDL reload, and the boot sync. They already disagreed once, and the
 * disagreement is invisible -- each site looks correct on its own.
 *
 * @module init/sync-outcome
 */

/** The shape both registries answer with, read defensively from an untyped result. */
interface SyncReport {
  created?: unknown;
  updated?: unknown;
  errors?: unknown;
}

function slugList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((slug): slug is string => typeof slug === "string")
    : [];
}

/**
 * The slugs the sync REPORTED AN ERROR for, whatever else it says about them.
 *
 * The raw reading, and the one that is right for a caller asking "did anything
 * go wrong for this entity" -- a failed permission seed is a real failure worth
 * logging, even though the row landed.
 */
export function erroredSlugs(result: unknown): string[] {
  if (typeof result !== "object" || result === null) return [];
  const errors = (result as SyncReport).errors;
  if (!Array.isArray(errors)) return [];
  return errors
    .map(entry =>
      typeof entry === "object" && entry !== null
        ? (entry as { slug?: unknown }).slug
        : undefined
    )
    .filter((slug): slug is string => typeof slug === "string");
}

/**
 * The slugs whose registry WRITE did not land.
 *
 * An error MINUS the writes the same report claims, because a slug in both
 * lists had its row written. This is the answer every "is the stored metadata
 * behind its table" question wants: a slug here kept its old field list, and a
 * slug that errored after its write did not.
 */
export function unwrittenSlugs(result: unknown): string[] {
  if (typeof result !== "object" || result === null) return [];
  const report = result as SyncReport;
  const written = new Set([
    ...slugList(report.created),
    ...slugList(report.updated),
  ]);
  return erroredSlugs(result).filter(slug => !written.has(slug));
}

/**
 * The slugs a metadata sync REWROTE -- the rows whose `migration_status` it
 * reset to `pending` and which an apply may therefore now mark applied.
 *
 * `updated` alone: `created` rows are caught by the caller's own absent-table
 * reading, and a row the sync left `unchanged` never moved.
 */
export function rewrittenSlugs(result: unknown): string[] {
  if (typeof result !== "object" || result === null) return [];
  return slugList((result as SyncReport).updated);
}
