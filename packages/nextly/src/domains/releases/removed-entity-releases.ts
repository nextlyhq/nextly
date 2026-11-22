/**
 * Releases holding a document of a collection or Single removed from code.
 *
 * Such an entity's registry row says the app's code defines it, and the
 * running configuration no longer declares it. Every write to its entries is
 * refused until it is retired or declared again, a release's own write
 * included, so a release holding one of its documents can never run. Its
 * readiness reports that as a hard problem (`core.removed-from-code`), and
 * the release engine's first run under the configuration that removed the
 * entity stops each scheduled release holding one, before its time, telling
 * its owner, rather than leaving it scheduled to fail at its time.
 *
 * Nothing at the server's start does this: a start writes nothing, and the
 * engine's run is the first writer after a deploy.
 *
 * Whether an entity is removed from code is the write guard's own decision
 * (`entityRemovedFromCode`, and `rowRemovedFromCode` for a registry row in
 * hand), asked here rather than decided again, so the
 * check and the refusal it predicts cannot come to disagree.
 *
 * @module domains/releases/removed-entity-releases
 */
import { getService } from "../../di/service-access";
import {
  entityRemovedFromCode,
  rowRemovedFromCode,
} from "../dynamic-collections/services/removed-from-code-writes";

import {
  stopReleasesHoldingOrThrow,
  type EarlyStopOptions,
} from "./early-stop";
import type { ReleaseCheckScope } from "./readiness/check-sources";
import type { ReleaseRecheckTarget } from "./release-recheck";

/**
 * Whether a release member's scope is a collection or Single removed from
 * code. A page is neither, and the rule says nothing about it.
 */
export function scopeRemovedFromCode(
  scope: ReleaseCheckScope
): Promise<boolean> {
  if (scope.scopeKind === "page") return Promise.resolve(false);
  return entityRemovedFromCode(scope.scopeKind, scope.scopeSlug);
}

/**
 * The collections and Singles removed from code, as release scopes.
 *
 * Read from the registries' cached listings and judged by the write guard's
 * decision for rows already in hand (`rowRemovedFromCode`), so it costs no
 * database read and grows with the number of entities a site has, never with
 * its releases or their documents. Empty while no configuration is published,
 * as the guard reads it.
 */
export async function removedEntityScopes(): Promise<ReleaseCheckScope[]> {
  const [collections, singles] = await Promise.all([
    getService("collectionRegistryService").getAllCollectionsForRead(),
    getService("singleRegistryService").getAllSinglesForRead(),
  ]);
  return [
    ...collections
      .filter(row => rowRemovedFromCode("collection", row))
      .map(row => ({ scopeKind: "collection" as const, scopeSlug: row.slug })),
    ...singles
      .filter(row => rowRemovedFromCode("single", row))
      .map(row => ({ scopeKind: "single" as const, scopeSlug: row.slug })),
  ];
}

/**
 * Stop every scheduled release holding a document of an entity removed from
 * code, and tell each one's owner.
 *
 * Asks first which entities are removed, which on almost every pass is none,
 * and then stops nothing. Otherwise the removed entities are handed to the
 * early stop, which finds the scheduled releases' members in them through the
 * members' scope index, checks those members with the hard sources, stops
 * each failing release through the one transition into `blocked` (with its
 * due component, when it is due) and tells its owner once. A release already
 * stopped is no longer scheduled, so a later pass finds no member to check,
 * and stops and tells nothing twice.
 *
 * `outOfTime` bounds it for a caller with a deadline: the early stop judges
 * releases only while it answers no, at least one each call, and stops those
 * it judged; the rest stay scheduled for the next call, which does not find
 * the ones already stopped, so each call advances.
 *
 * A failure reaches the caller, which reports it as this step's.
 * `removedScopes` and `stop` are the reads above, injected so the step is
 * testable without a booted runtime.
 */
export async function stopReleasesOfRemovedEntities(
  deps: EarlyStopOptions & {
    removedScopes?: () => Promise<readonly ReleaseCheckScope[]>;
    stop?: (
      target: ReleaseRecheckTarget,
      options: EarlyStopOptions
    ) => Promise<void>;
  } = {}
): Promise<void> {
  const removed = await (deps.removedScopes ?? removedEntityScopes)();
  if (removed.length === 0) return;
  await (deps.stop ?? stopReleasesHoldingOrThrow)(
    { scopes: [...removed] },
    { outOfTime: deps.outOfTime }
  );
}
