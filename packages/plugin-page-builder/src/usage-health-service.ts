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
  usageBackfillStateStore,
  usageCountReader,
} from "./class-usage-runtime";
import { backfillGeneration } from "./usage-backfill-scope";
import { backfillScopes, type BackfillHost } from "./usage-backfill-wiring";
import type { UsageIndex, UsageSubject } from "./usage-index";
import {
  readUsageIndexHealth,
  type UsageIndexHealth,
} from "./usage-index-health";

/** The service key a host reads this through. */
export const USAGE_HEALTH_SERVICE = "usage-health";

/** What the service offers: the index-wide facts, for one index. */
export interface UsageHealthService {
  /**
   * Read how much of one index is there.
   *
   * Takes the INDEX rather than assuming the component one, because the class
   * index answers the same question and a surface asking about classes should
   * not get an answer about components.
   */
  read<TRow extends UsageSubject>(
    index: UsageIndex<TRow>,
    /** Which index collection to read, RESOLVED — an integrator may rename it. */
    indexCollection: string
  ): Promise<UsageIndexHealth>;
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
    read: async (index, indexCollection) => {
      const installed = host();
      const nextly = installed.nextly();

      return readUsageIndexHealth({
        index,
        read: usageCountReader(nextly, indexCollection),
        backfill: {
          scopes: () => backfillScopes(installed),
          state: usageBackfillStateStore(
            nextly,
            installed.slugs().backfillState,
            backfillGeneration(installed.limits())
          ),
          unreachable: () => installed.singlesHoldBlocks(),
        },
      });
    },
  };
}
