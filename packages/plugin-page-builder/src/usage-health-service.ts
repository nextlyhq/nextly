/**
 * The health reader, bound to the installation that can actually answer it.
 *
 * `readUsageIndexHealth` takes the backfill's scopes and progress store as an
 * OPTIONAL argument, and without them it answers `coversExistingDocuments:
 * false` — the conservative reading for a caller that cannot tell. That default
 * is right and it is not enough on its own: nothing outside this package can
 * assemble those two values, so every consumer took the conservative branch and
 * a finished backfill changed nothing anybody could observe. The work ran and
 * the answer stayed a floor.
 *
 * This is the seam that closes it. The plugin already builds a `BackfillHost`
 * at install — the registry enumeration, the resolved slugs, the limits
 * generation — so the same object that drives the sweep answers the question
 * the sweep exists to change.
 *
 * Offered as a SERVICE rather than exported as a function, because what it
 * needs is the installed context rather than arguments: a caller outside the
 * plugin has no way to name the collections the registry holds or the
 * generation the index was derived under, and handing them a function that
 * demands both would move the same problem one level out.
 *
 * @module usage-health-service
 */
import {
  backfillSurvey,
  hostGeneration,
  type BackfillHost,
} from "./usage-backfill-wiring";
import type {
  GroupedUsageReader,
  UsageIndex,
  UsageSubject,
} from "./usage-index";
import {
  usageIndexHealthFrom,
  type UsageIndexHealth,
} from "./usage-index-health";
import {
  anyUndetermined,
  usageTableGroups,
  usageTableOf,
} from "./usage-index-tables";

/** The service key a host reads this through. */
export const USAGE_HEALTH_SERVICE = "usage-health";

/** What the service offers: the index-wide facts, for one index, and its counts. */
export interface UsageHealthService {
  /**
   * Read how much of one index is there.
   *
   * Takes the INDEX rather than assuming the component one, because the class
   * index answers the same question and a surface asking about classes should
   * not get an answer about components.
   *
   * The index's rows are read from the table the plugin keeps them in, which
   * the index names; `indexCollection` is accepted for the callers written
   * when they lived in a collection, and is not consulted.
   */
  read<TRow extends UsageSubject>(
    index: UsageIndex<TRow>,
    indexCollection?: string
  ): Promise<UsageIndexHealth>;
  /**
   * The grouped read a count of one index is asked through
   * (`componentUsageCount`'s `read`), over the table its rows live in.
   */
  counts<TRow extends UsageSubject>(
    index: UsageIndex<TRow>
  ): GroupedUsageReader;
}

/**
 * Build the service from the installed host.
 *
 * Everything is resolved PER CALL rather than captured: a site can gain a
 * collection or move its bounds between one render and the next, and a health
 * answer built from values captured at install would describe the site as it
 * was when the plugin loaded.
 */
export function usageHealthService(
  host: () => BackfillHost
): UsageHealthService {
  return {
    read: async index => {
      const installed = host();

      // ONE registry walk, both answers. Asking for the scopes and for what the
      // scopes cannot reach separately would walk the registry twice per health
      // render and let the two answers come from different moments.
      const survey = await backfillSurvey(installed);

      // The run, its progress, the dirty mark and the index's own marker rows,
      // all from ONE snapshot, so the markers are the ones the recorded run
      // left, whatever writers do meanwhile.
      const snapshot = await installed
        .bookkeeping()
        .snapshot(tx => anyUndetermined(tx, index));
      return usageIndexHealthFrom(
        {
          scopes: survey.scopes,
          progress: {
            current: snapshot.generation === hostGeneration(installed),
            dirty: snapshot.dirty,
            completed: snapshot.done,
          },
          unreachable: survey.unaddressable,
        },
        snapshot.probed
      );
    },
    counts: index => usageTableGroups(host().db, usageTableOf(index)),
  };
}
