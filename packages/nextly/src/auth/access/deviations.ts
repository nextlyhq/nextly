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
  // A signed-in user's declared rule decides alone, without the permission.
  "rule-alone-for-people",
  // A visitor with no rule is allowed every action but a publish or an
  // unpublish, where the decision reads the Public role's permissions.
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

/** What a listening test is told: every deviation, and each by its subject. */
interface Listener {
  readonly seen: Set<Deviation>;
  readonly bySubject: Map<string, Set<Deviation>>;
}

const listening = new AsyncLocalStorage<Listener>();
const subjects = new AsyncLocalStorage<string>();

/**
 * Today's answer where a way in still deviates from the decision. `decided`
 * is the decision's answer, worked out only while a test listens; when the
 * two differ, the deviation is recorded, under the subject it was decided for
 * when there is one ({@link aboutSubject}).
 */
export async function deviate(
  name: Deviation,
  today: boolean,
  decided: () => boolean | Promise<boolean>
): Promise<boolean> {
  const listener = listening.getStore();
  if (listener && (await decided()) !== today) {
    listener.seen.add(name);
    const subject = subjects.getStore();
    if (subject !== undefined) {
      let named = listener.bySubject.get(subject);
      if (!named) listener.bySubject.set(subject, (named = new Set()));
      named.add(name);
    }
  }
  return today;
}

/**
 * Runs `work` as the decision about one subject (a collection, a permission),
 * so a way in that decides many at once still says which deviation belongs to
 * which. Outside a test nothing listens, and the work runs as it is.
 */
export function aboutSubject<T>(subject: string, work: () => T): T {
  return listening.getStore() ? subjects.run(subject, work) : work();
}

/** The deviations in `seen`, in the order {@link DEVIATIONS} names them. */
const inOrder = (seen: ReadonlySet<Deviation>): Deviation[] =>
  DEVIATIONS.filter(name => seen.has(name));

/**
 * Runs `work` and reports each deviation that changed an answer during it,
 * in the order {@link DEVIATIONS} names them, and those recorded about each
 * subject.
 */
export async function recordingDeviations<T>(work: () => Promise<T>): Promise<{
  result: T;
  deviations: Deviation[];
  bySubject: ReadonlyMap<string, Deviation[]>;
}> {
  const listener: Listener = { seen: new Set(), bySubject: new Map() };
  const result = await listening.run(listener, work);
  return {
    result,
    deviations: inOrder(listener.seen),
    bySubject: new Map(
      [...listener.bySubject].map(([subject, seen]) => [subject, inOrder(seen)])
    ),
  };
}
