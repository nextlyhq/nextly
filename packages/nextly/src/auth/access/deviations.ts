/**
 * Where a way in still answers differently from the one decision, by name.
 *
 * Each way in asks the decision and presents its answer. Where today's
 * answer differs from the decision's, the way in keeps today's answer through
 * a named deviation, so no answer changes when a way in moves onto the
 * decision, and every difference that remains is one of the names below.
 * Each is deleted by the change that makes that answer the decision's.
 *
 * A deviation that changed an answer is recorded while a test listens
 * ({@link recordingDeviations}), so the access table can check that every
 * disagreement it lists at a way in that asks the decision is explained by a
 * deviation that way in still has, and that none goes unlisted. Outside a test
 * nothing listens, and a deviation costs one context read.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const DEVIATIONS = [
  // A signed-in user's declared rule decides alone, judged truthy, without
  // the permission.
  "rule-alone-for-people",
  // A visitor with no rule is allowed every action but a publish or an
  // unpublish, and a rule refuses a visitor only by answering `false`.
  "visitor-public-default",
  // A publish or an unpublish is judged on its own permission and rule, not
  // on update's as well.
  "lifecycle-judged-alone",
  // Without the access-control service, no rule is read, and a signed-in
  // user's grants are read only where a way in reads them without it: the
  // collection gate and relationship population judge them alone, while the
  // entity readers and the system-resource readers refuse the user.
  "no-service",
  // A Single asked by a route that authorized no user falls through to the
  // visitor's answer, where a collection refuses.
  "single-route-authorized-visitor",
  // A Single reads the key scope it is handed, never the request's.
  "single-explicit-scope-only",
  // A super-admin role named on a server-supplied `user` passes without a
  // lookup.
  "claimed-super-admin",
  // A key's permission is matched on its stored slug, so a scope carrying
  // slugs without grant rows is judged on the slugs.
  "key-slug-string-match",
  // A route that accepts any of several permissions asks no rule, for people
  // or keys, even where the target declares one.
  "any-of-skips-rules",
  // A route asking one permission on a system resource, and the
  // system-resource readers, do not count that resource's `manage-`
  // permission as read, create, update or delete on it.
  "manage-not-counted",
  // A read with no caller, a visitor or a plugin's person, keeps the media
  // rows it populates, where the decision refuses a caller with no grant.
  "visitor-keeps-media",
  // `ctx.caller.can` hands back a signed-in user's rule answer as the rule
  // gave it, `null` or a string included, rather than a yes or no.
  "can-returns-raw-rule-value",
  // Without the access-control service, `ctx.caller.can` and a held
  // permission refuse a signed-in user, where a route reads their permission.
  "can-no-service-refuses-people",
  // `ctx.caller.can` and a held permission refuse an empty action or
  // resource, a super-admin's included.
  "can-refuses-empty-action-or-resource",
  // A key holds a named permission by its stored slug alone: the target's
  // rule is not read, nor, for a publish or an unpublish, update's.
  "holds-permission-key-skips-rules",
  // The schema list shows a collection to whoever holds its read permission,
  // without reading the collection's read rule.
  "schema-list-ignores-rules",
] as const;

export type Deviation = (typeof DEVIATIONS)[number];

const listening = new AsyncLocalStorage<Set<Deviation>>();

/**
 * Today's answer where a way in still deviates from the decision. `decided`
 * is the decision's answer, worked out only while a test listens; when the
 * two differ, the deviation is recorded.
 */
export async function deviate(
  name: Deviation,
  today: boolean,
  decided: () => boolean | Promise<boolean>
): Promise<boolean> {
  const seen = listening.getStore();
  if (seen && (await decided()) !== today) seen.add(name);
  return today;
}

/**
 * Runs `work` and reports each deviation that changed an answer during it,
 * in the order {@link DEVIATIONS} names them.
 */
export async function recordingDeviations<T>(
  work: () => Promise<T>
): Promise<{ result: T; deviations: Deviation[] }> {
  const seen = new Set<Deviation>();
  const result = await listening.run(seen, work);
  return { result, deviations: DEVIATIONS.filter(name => seen.has(name)) };
}
