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
 * (`entityRemovedFromCode`), asked here rather than decided again, so the
 * check and the refusal it predicts cannot come to disagree.
 *
 * @module domains/releases/removed-entity-releases
 */
import { entityRemovedFromCode } from "../dynamic-collections/services/removed-from-code-writes";

import { stopReleasesHolding } from "./early-stop";
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
 * Stop every scheduled release holding a document of an entity removed from
 * code, and tell each one's owner.
 *
 * Asks first which entities the scheduled releases' documents are in, and
 * whether each was removed, so a site with none removed reads the scopes and
 * nothing more: a declared entity is answered from the published
 * configuration. The releases holding a removed one are handed to the early
 * stop, which checks those members with the hard sources, stops each failing
 * release through the one transition into `blocked` (with its due component,
 * when it is due) and tells its owner once. A release already stopped is no
 * longer scheduled, so a later run stops and tells nothing twice.
 *
 * `isRemoved` and `stop` are the decision and the early stop above, injected
 * so the step is testable without a booted runtime.
 */
export async function stopReleasesOfRemovedEntities(deps: {
  repository: {
    scheduledMemberScopes(): Promise<readonly ReleaseCheckScope[]>;
  };
  isRemoved?: (scope: ReleaseCheckScope) => Promise<boolean>;
  stop?: (target: ReleaseRecheckTarget) => Promise<void>;
}): Promise<void> {
  const isRemoved = deps.isRemoved ?? scopeRemovedFromCode;
  const removed: ReleaseCheckScope[] = [];
  for (const scope of await deps.repository.scheduledMemberScopes()) {
    if (await isRemoved(scope)) removed.push(scope);
  }
  if (removed.length === 0) return;
  await (deps.stop ?? stopReleasesHolding)({ scopes: removed });
}
