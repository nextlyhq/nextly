/**
 * The page builder's `onMigrate` and `onInstall`: count the site's pages into
 * the usage index once a deploy's `nextly migrate`, or `nextly plugins
 * install`, is done, so a deployed site starts counted.
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
import {
  indexIsWhole,
  usageCoverageGap,
  type UsageCoverageGap,
  type UsageIndexHealth,
} from "./usage-index-health";

/** The most a migrate, or an install, spends counting the pages. */
export const MIGRATE_COUNT_MS = 60_000;

/** The most one sweep asked for runs: the runner holds a sweep run now to 20 s. */
const ONE_SWEEP_MS = 20_000;

/** How the count after a migrate ended. */
export type MigrateCountOutcome =
  /** Every page is counted. */
  | { kind: "whole" }
  /** Another runner holds the count; it, or the next pass, finishes it. */
  | { kind: "held-elsewhere" }
  /** The time ran out; the next run, a removal or Count now goes on. */
  | { kind: "unfinished" }
  /**
   * The backfill has nothing left to do and the index is still not whole:
   * no further sweep changes that, so none is run.
   */
  | { kind: "incomplete"; gap: UsageCoverageGap };

/**
 * Run the usage backfill, a sweep at a time, until the index is whole, the
 * time runs out, another runner turns out to hold it, or the backfill has
 * nothing left to do while the index still is not whole: content it cannot
 * read whole or cannot reach keeps it a floor however often it sweeps, and
 * sweeping on would only add job rows until the time ran out.
 */
export async function countAfterMigrate(deps: {
  /** Runs the backfill's sweep now; `ran` false when another runner holds it. */
  sweep: (maxDurationMs: number) => Promise<{ ran: boolean }>;
  /** The index's health now. */
  health: () => Promise<UsageIndexHealth>;
  /** The live clock, injected for tests. */
  now?: () => number;
}): Promise<MigrateCountOutcome> {
  const now = deps.now ?? (() => Date.now());
  const deadline = now() + MIGRATE_COUNT_MS;
  for (;;) {
    const health = await deps.health();
    if (indexIsWhole(health)) return { kind: "whole" };
    const gap = usageCoverageGap(health);
    if (gap !== undefined) return { kind: "incomplete", gap };
    const left = deadline - now();
    if (left <= 0) return { kind: "unfinished" };
    const { ran } = await deps.sweep(Math.min(left, ONE_SWEEP_MS));
    if (!ran) return { kind: "held-elsewhere" };
  }
}

/** Why coverage stays incomplete, in the words a person reads. */
export function coverageGapWords(gap: UsageCoverageGap): string {
  return gap === "undetermined"
    ? "some pages are too large to read in full, so what they use is not counted"
    : "some content keeps its blocks in a field nested under a named group, which the count cannot reach";
}

/** What the command's output says of each outcome. */
function migrateCountMessage(outcome: MigrateCountOutcome): string {
  switch (outcome.kind) {
    case "whole":
      return "Every page is counted for the Design panel's usage.";
    case "held-elsewhere":
      return "The pages are being counted by another run, which finishes the count.";
    case "unfinished":
      return "Some pages are still to count; the next run of nextly migrate, a removal or Count now goes on from here.";
    case "incomplete":
      return `Coverage remains incomplete: ${coverageGapWords(outcome.gap)}.`;
  }
}

/**
 * The page builder's count after a migrate and after an install: the one
 * bounded count, logged as it ended. One helper for both, so a first deploy
 * that migrates before `nextly plugins install` is counted by the install.
 */
export async function countThePages(deps: {
  sweep: (maxDurationMs: number) => Promise<{ ran: boolean }>;
  health: () => Promise<UsageIndexHealth>;
  log: (message: string) => void;
  now?: () => number;
}): Promise<MigrateCountOutcome> {
  const outcome = await countAfterMigrate(deps);
  deps.log(migrateCountMessage(outcome));
  return outcome;
}
