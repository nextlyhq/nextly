/**
 * Which Singles the app's configuration still declares, and which registry
 * rows are removed code-first Singles rather than live ones.
 *
 * Removing a code-first Single from config, or the plugin that contributes one,
 * leaves its registry row readable until someone runs the destructive cleanup,
 * and the Singles listing a plugin reads returns it with `source: "code"`, or
 * `plugin:<name>`; telling a live Single from a leftover
 * is the caller's to do, against `ctx.config.singles`. One reading of that, so
 * the usage index's completeness and the site-style route's access gate cannot
 * disagree about which Singles exist.
 *
 * @module declared-singles
 */

/** The slugs the app's configuration still declares as Singles. */
export function declaredSingleSlugs(ctx: {
  config?: { singles?: unknown };
}): ReadonlySet<string> | undefined {
  const singles = ctx.config?.singles;
  // No list at all is not an empty list. A config shape this cannot read must
  // not be treated as declaring nothing, which would make every registry row an
  // orphan and hide real content from the completeness answer.
  if (!Array.isArray(singles)) return undefined;
  const slugs = new Set<string>();
  for (const single of singles) {
    const slug = (single as { slug?: unknown } | null)?.slug;
    if (typeof slug === "string" && slug.length > 0) slugs.add(slug);
  }
  return slugs;
}

/**
 * Whether a registry row is one the configuration declares: the app's own
 * (`code`) or a plugin's (`plugin:<name>`). A Builder-made Single exists
 * nowhere else, so its registry row IS the declaration.
 */
export function declaredByConfig(row: unknown): boolean {
  const source = (row as { source?: unknown } | null)?.source;
  return (
    source === "code" ||
    (typeof source === "string" && source.startsWith("plugin:"))
  );
}

/**
 * Whether a registry row is a removed code-first Single rather than a live one.
 *
 * Only a row the configuration declares can be one (`declaredByConfig`).
 *
 * Anything this cannot read is NOT an orphan. A row with no readable slug, or a
 * configuration this could not enumerate, keeps the Single counted — the
 * direction that withholds completeness rather than the one that grants it over
 * content nobody looked at.
 */
export function isOrphanedSingle(
  row: unknown,
  declared: ReadonlySet<string> | undefined
): boolean {
  if (declared === undefined) return false;
  if (!declaredByConfig(row)) return false;
  const slug = (row as { slug?: unknown }).slug;
  if (typeof slug !== "string" || slug.length === 0) return false;
  return !declared.has(slug);
}
