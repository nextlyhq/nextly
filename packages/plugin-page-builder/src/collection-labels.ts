/**
 * A collection's names as a registry record holds them, read in one place:
 * the pages search, the loop collections route and a list's judgement at
 * save all name a collection by these, so an author reads one name for it
 * everywhere.
 *
 * A leaf, importing nothing, so the save's judgement can read a name without
 * loading a route.
 *
 * @module collection-labels
 */

/**
 * The label the registry listing already resolved (the singular name, or the
 * slug where there is none), rather than a second rule here.
 */
export function labelOf(record: Record<string, unknown>, slug: string): string {
  return typeof record.label === "string" && record.label !== ""
    ? record.label
    : slug;
}

/** The plural name a registry record holds (`labels.plural`), if any. */
export function pluralLabelOf(record: Record<string, unknown>): {
  pluralLabel?: string;
} {
  const labels = record.labels;
  if (typeof labels !== "object" || labels === null) return {};
  const plural = (labels as { plural?: unknown }).plural;
  return typeof plural === "string" && plural !== ""
    ? { pluralLabel: plural }
    : {};
}
