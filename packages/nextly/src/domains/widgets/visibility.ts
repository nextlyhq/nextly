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
  canReadEntity,
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

/**
 * Which of these collections the caller may actually read.
 *
 * 🔴 `canReadEntity`, not `callerHoldsPermission`, and the difference is an API
 * key: the second reads only the key's stamped grant while the first also
 * evaluates the collection's code-defined `access.read`. The widget QUERY
 * endpoint asks the first, so anything deciding whether to OFFER a card for a
 * collection has to ask the same one — otherwise a card is advertised, placed,
 * and then refused on every request.
 *
 * Two surfaces need this — the layout endpoint filters what it places and
 * offers, and the workspace payload filters which collections it names — and a
 * copy in either that drifted would be a disclosure rather than a cosmetic
 * difference. Batched in the same bounded rounds as the permission verdicts
 * above, and a rejected decision denies.
 */
export async function readableCollections(
  slugs: readonly (string | undefined)[],
  caller: ReadAccessCaller
): Promise<Set<string>> {
  const distinct = [
    ...new Set(
      slugs.filter(
        (slug): slug is string => typeof slug === "string" && slug !== ""
      )
    ),
  ];

  const readable = new Set<string>();
  for (const group of authorizationGroups(distinct)) {
    const settled = await Promise.allSettled(
      group.map(slug => canReadEntity(slug, caller))
    );
    group.forEach((slug, index) => {
      const outcome = settled[index];
      if (outcome.status === "fulfilled" && outcome.value) readable.add(slug);
    });
  }
  return readable;
}
