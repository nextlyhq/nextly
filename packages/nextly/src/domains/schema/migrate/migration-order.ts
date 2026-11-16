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

/**
 * A name `migrate:create` writes: a UTC timestamp first (`YYYYMMDD_HHMMSS`,
 * then milliseconds in current releases).
 */
const TIMESTAMPED = /^\d{8}_\d{6}/;

/**
 * Which of two app migrations is the newer, by base name: a timestamped name
 * outranks one without a timestamp, and names of the same kind compare in
 * run order (`compareMigrationBaseNames`).
 *
 * Run order alone would rank a hand-named file (`get_started_only`) above
 * every timestamped one, since a letter sorts after a digit, though such a
 * file predates the names `migrate:create` writes and is applied before
 * them. "Newest" is asked of the build's migrations folder and of the
 * database's ledger, and the two answers are compared, so both ask this,
 * which reads the names alone: the folder has no applied times to read.
 */
export function compareMigrationRecency(a: string, b: string): number {
  const aTimestamped = TIMESTAMPED.test(a);
  if (aTimestamped !== TIMESTAMPED.test(b)) return aTimestamped ? 1 : -1;
  return compareMigrationBaseNames(a, b);
}
