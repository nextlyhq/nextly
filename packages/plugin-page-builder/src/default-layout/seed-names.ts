/**
 * The titles and slugs the seed gives what it creates: the default set
 * ("Main") and, on a fresh site, its starter header and footer components.
 *
 * The seed never takes a name an author already holds: an author's "Main"
 * stays theirs, and the seed becomes "Main 2". What the seed made is found
 * again by the ids it recorded, never by these names, so a numbered name
 * costs nothing.
 *
 * @module default-layout/seed-names
 */

/** The title the seeded Layout is given when nothing holds it. */
const SEED_TITLE = "Main";

/** The slug the seeded Layout is given when nothing holds it. */
const SEED_SLUG = "main";

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

/** The seed's title: the first free of "Main", "Main 2", ... */
export function seedTitle(taken: ReadonlySet<string>): string {
  return firstFree(SEED_TITLE, " ", taken);
}

/** The seed's slug: the first free of "main", "main-2", ... */
export function seedSlug(taken: ReadonlySet<string>): string {
  return firstFree(SEED_SLUG, "-", taken);
}

/** The area a starter component fills. */
export type StarterArea = "header" | "footer";

/** The starter components' titles and slugs when nothing holds them. */
const STARTER_NAMES: {
  readonly [A in StarterArea]: {
    readonly title: string;
    readonly slug: string;
  };
} = {
  header: { title: "Starter header", slug: "starter-header" },
  footer: { title: "Starter footer", slug: "starter-footer" },
};

/** A starter component's title: "Starter header", "Starter header 2", ... */
export function starterTitle(
  area: StarterArea,
  taken: ReadonlySet<string>
): string {
  return firstFree(STARTER_NAMES[area].title, " ", taken);
}

/** A starter component's slug: "starter-header", "starter-header-2", ... */
export function starterSlug(
  area: StarterArea,
  taken: ReadonlySet<string>
): string {
  return firstFree(STARTER_NAMES[area].slug, "-", taken);
}
