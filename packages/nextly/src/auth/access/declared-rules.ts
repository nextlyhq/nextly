/**
 * The code rules apps declare on their collections and Singles, held apart
 * from the access-control service.
 *
 * A rule is configuration: `defineCollection({ access })` declares it whether
 * or not an access-control service is registered to read it. The service keeps
 * its own copy and writes each registration through to here, so the decision
 * can read a target's rules whatever the service's state, which is what giving
 * the same answer with or without the service needs.
 *
 * Read only where a way in compares today's answer with the decision's
 * (`gate-adapters`); every way in still answers from its own service, or its
 * absence, as it always has.
 */
import type { AccessTarget } from "./decide";

const declared = new Map<string, AccessTarget>();

/**
 * Records the rules a collection or Single declares. A collection's rules are
 * kept over a Single's under the same slug, as the access-control service
 * resolves a slug: collections first.
 */
export function declareTarget(target: AccessTarget): void {
  const known = declared.get(target.slug);
  if (target.kind === "single" && known?.kind === "collection") return;
  declared.set(target.slug, target);
}

/** The rules declared for `slug`, or `undefined` when none were. */
export function declaredTarget(slug: string): AccessTarget | undefined {
  return declared.get(slug);
}

/**
 * The target as its app declared it: with the rules declared for its slug when
 * any were, else as given. What a way in hands the decision when it compares
 * today's answer with the decision's, whatever the access-control service's
 * state.
 */
export function targetAsDeclared(target: AccessTarget): AccessTarget {
  return declaredTarget(target.slug) ?? target;
}

/** Forgets every declared rule, as a re-sync does before registering again. */
export function clearDeclaredTargets(): void {
  declared.clear();
}
