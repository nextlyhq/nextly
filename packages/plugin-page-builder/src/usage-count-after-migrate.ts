/**
 * The page builder's `onMigrate`: count the site's pages into the usage index
 * once a deploy's `nextly migrate` is done, so a deployed site starts counted.
 *
 * A production start writes nothing, and a site no scheduler drains has no
 * other moment the backfill runs: until a person pressed Count now, or a
 * removal counted for itself, every count read as "not counted yet". The
 * migrate a deploy runs is that moment, bounded so a large site does not hold
 * the deploy: what is not counted in {@link MIGRATE_COUNT_MS} is counted by the
 * next run, a removal or Count now, the backfill's progress being durable.
 *
 * Safe twice at once, as `onMigrate` must be (it runs after migrate's lock is
 * released): the backfill is a sweep with one row, which one runner holds, so
 * a second run asked for meanwhile claims nothing, and this stops there,
 * leaving the count to the runner that holds it.
 *
 * @module usage-count-after-migrate
 */

/** The most a migrate spends counting the pages. */
export const MIGRATE_COUNT_MS = 60_000;

/** The most one sweep asked for runs: the runner holds a sweep run now to 20 s. */
const ONE_SWEEP_MS = 20_000;

/** How the count after a migrate ended. */
export type MigrateCountOutcome =
  /** Every page is counted. */
  | "whole"
  /** Another runner holds the count; it, or the next pass, finishes it. */
  | "held-elsewhere"
  /** The time ran out; the next run, a removal or Count now goes on. */
  | "unfinished";

/**
 * Run the usage backfill, a sweep at a time, until the index is whole, the
 * time runs out, or another runner turns out to hold it.
 */
export async function countAfterMigrate(deps: {
  /** Runs the backfill's sweep now; `ran` false when another runner holds it. */
  sweep: (maxDurationMs: number) => Promise<{ ran: boolean }>;
  /** Whether the index can answer for every page now. */
  whole: () => Promise<boolean>;
  /** The live clock, injected for tests. */
  now?: () => number;
}): Promise<MigrateCountOutcome> {
  const now = deps.now ?? (() => Date.now());
  const deadline = now() + MIGRATE_COUNT_MS;
  for (;;) {
    if (await deps.whole()) return "whole";
    const left = deadline - now();
    if (left <= 0) return "unfinished";
    const { ran } = await deps.sweep(Math.min(left, ONE_SWEEP_MS));
    if (!ran) return "held-elsewhere";
  }
}

/** What the migrate's output says of each outcome. */
export function migrateCountMessage(outcome: MigrateCountOutcome): string {
  switch (outcome) {
    case "whole":
      return "Every page is counted for the Design panel's usage.";
    case "held-elsewhere":
      return "The pages are being counted by another run, which finishes the count.";
    case "unfinished":
      return "Some pages are still to count; the next run of nextly migrate, a removal or Count now goes on from here.";
  }
}
