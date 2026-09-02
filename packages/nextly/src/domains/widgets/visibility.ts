/**
 * Which widgets a reader may be told exist.
 *
 * ONE implementation, because two surfaces ask it and a disagreement between
 * them is a disclosure rather than a cosmetic difference. The layout endpoint
 * asks so it can place and offer; the admin's workspace payload asks so it can
 * ship the declarations for cards derived from a collection's own name. A copy
 * in the second that drifted from the first would publish the existence and the
 * slug of every collection an install has to a reader the first was hiding them
 * from.
 *
 * @module domains/widgets/visibility
 */

import {
  authorizationGroups,
  callerHoldsPermission,
  type ReadAccessCaller,
} from "../../auth/entity-read-access";

/**
 * A decision per permission slug, taken in the bounded rounds the query batch
 * already prescribes.
 *
 * Memoized per SLUG, not per widget: several widgets commonly name the same
 * permission, and a permission check resolves a session caller through a
 * per-user TTL cache, so asking twice is two database reads for one answer.
 */
export async function permissionVerdicts(
  slugs: readonly (string | undefined)[],
  caller: ReadAccessCaller
): Promise<Map<string, boolean>> {
  const distinct = [
    ...new Set(
      slugs.filter(
        (slug): slug is string => typeof slug === "string" && slug !== ""
      )
    ),
  ];

  const verdicts = new Map<string, boolean>();
  for (const group of authorizationGroups(distinct)) {
    const settled = await Promise.allSettled(
      group.map(slug => callerHoldsPermission(slug, caller))
    );
    group.forEach((slug, index) => {
      const outcome = settled[index];
      // A rejected decision DENIES. A permission check that threw has told us
      // nothing, and "nothing" must not read as "allowed" -- the same
      // fail-closed direction `canReadEntity` takes when RBAC is unreachable.
      verdicts.set(slug, outcome.status === "fulfilled" && outcome.value);
    });
  }
  return verdicts;
}

/**
 * Whether a reader holding `verdicts` may know this widget exists.
 *
 * A widget with no `requiredPermission` is visible to any authenticated reader
 * -- that is what omitting it means, and what core's own cards rely on. A
 * declared permission that is not a usable string is refused rather than read
 * as absent: the gap used to fail OPEN, so a widget whose author wrote an
 * object there was gated for nobody.
 */
export function holdsWidgetPermission(
  requiredPermission: unknown,
  verdicts: ReadonlyMap<string, boolean>
): boolean {
  if (requiredPermission === undefined) return true;
  if (typeof requiredPermission !== "string" || requiredPermission === "") {
    return false;
  }
  return verdicts.get(requiredPermission) === true;
}
