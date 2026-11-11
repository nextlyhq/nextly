/**
 * The order app migrations run in, by base name.
 *
 * A module of its own, importing nothing, so the code that runs while
 * Next.js loads `next.config` (`withNextly`, which names the build's newest
 * migration) orders the folder by the same rule the runner applies it in,
 * without loading the migration runner to do so.
 *
 * @module domains/schema/migrate/migration-order
 */

/**
 * The order two app migrations run in, by base name (the filename without
 * `.sql`): code-unit order, so the timestamp prefix decides. The comparator
 * the run order sorts by, exported so anything that has to agree with the
 * run order asks this rather than sorting by a rule of its own.
 */
export function compareMigrationBaseNames(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
