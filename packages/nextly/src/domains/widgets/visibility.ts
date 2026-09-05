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

import { requiredPermissionSlugs } from "./gate";

// Re-exported from its own module rather than moved-and-forgotten: this is
// where every caller already reaches for the gate, and the decision now lives
// beside the reader it is built from.
export { holdsWidgetPermission, requiredPermissionSlugs } from "./gate";

/**
 * A decision per permission slug, taken in the bounded rounds the query batch
 * already prescribes.
 *
 * Memoized per SLUG, not per widget: several widgets commonly name the same
 * permission, and a permission check resolves a session caller through a
 * per-user TTL cache, so asking twice is two database reads for one answer.
 */
export async function permissionVerdicts(
  gates: readonly unknown[],
  caller: ReadAccessCaller
): Promise<Map<string, boolean>> {
  // Read through the SAME function the gate below reads with, so the set
  // resolved here and the set asked about there cannot come apart. A gate may
  // now name several slugs, so this flattens rather than filters -- collecting
  // only the first of an any-of array would leave the others unresolved, and an
  // unresolved slug is a missing verdict, which denies.
  const distinct = [
    ...new Set(gates.flatMap(gate => requiredPermissionSlugs(gate) ?? [])),
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
