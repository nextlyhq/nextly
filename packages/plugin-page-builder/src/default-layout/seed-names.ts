/**
 * The title and slug the seeded default Layout is given.
 *
 * The seed never takes a name an authored Layout already holds: an author's
 * "Site layout" stays theirs, and the seed becomes "Site layout 2". The
 * seed is found again by the id the settings Single records, never by these
 * names, so a numbered name costs nothing.
 *
 * @module default-layout/seed-names
 */

/** The title the seeded Layout is given when nothing holds it. */
const SEED_TITLE = "Site layout";

/** The slug the seeded Layout is given when nothing holds it. */
const SEED_SLUG = "site-layout";

/**
 * The first of `base`, `base<sep>2`, `base<sep>3`, ... that `taken` does not
 * hold. Terminates: `taken` is finite, so some number past its size is free.
 */
function firstFree(
  base: string,
  separator: string,
  taken: ReadonlySet<string>
): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}${separator}${String(n)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The seed's title: the first free of "Site layout", "Site layout 2", ... */
export function seedTitle(taken: ReadonlySet<string>): string {
  return firstFree(SEED_TITLE, " ", taken);
}

/** The seed's slug: the first free of "site-layout", "site-layout-2", ... */
export function seedSlug(taken: ReadonlySet<string>): string {
  return firstFree(SEED_SLUG, "-", taken);
}
