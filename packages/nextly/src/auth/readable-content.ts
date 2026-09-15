/**
 * The content this caller may read, as a list rather than a question per slug.
 *
 * A surface that has to DESCRIBE an install rather than read one document needs
 * the coarse answer for every entity at once: which collections and singles are
 * in reach at all. Composed here rather than at each such surface, because the
 * composition is where the mistakes live. The dashboard's own version of it
 * once derived the set by filtering permission slugs, which looked equivalent
 * and was wrong in both directions: an entity authorized purely in code has no
 * permission row to find, and one REFUSED in code still has the row a slug
 * filter admits it on.
 *
 * Every part of the answer is already published by the module that owns it. The
 * registry says which entities exist, {@link readAccessCaller} converts the
 * caller once, and {@link readableEntities} takes the decision per entity
 * through `canReadEntity`. Nothing is decided here; the value of this module is
 * that the three are put together in ONE place, so a second caller cannot
 * assemble them differently.
 *
 * @module auth/readable-content
 */

import {
  registeredContentKindOf,
  registeredContentSnapshot,
} from "../services/lib/registered-content-slugs";

import type { AuthenticatedScope } from "./authenticated-scope";
import {
  canReadEntity,
  readAccessCaller,
  readableEntities,
} from "./entity-read-access";

/**
 * Who is asking, in exactly the fields the decision reads.
 *
 * Narrower than the `ReadCaller` the dashboard passes, deliberately: the
 * decision reads the id and the roles and nothing else, so demanding a whole
 * user context asks callers for fields it will not look at. Two different
 * `UserContext` interfaces exist in this package and they disagree about
 * whether `name` may be null, which a caller holding one of them should not
 * have to resolve to ask an access question.
 *
 * A richer object still satisfies it, so the dashboard's caller passes
 * unchanged.
 */
export interface ReadableContentCaller {
  user: { id: string; roles?: string[] };
  /** Present only for an API key; its presence is what selects the key branch. */
  authenticatedScope?: AuthenticatedScope;
}

/** One entity a caller may read, and which registry owns it. */
export interface ReadableContentEntity {
  slug: string;
  kind: "collection" | "single";
}

/**
 * What a caller may read, and whether that list is the WHOLE answer.
 *
 * The two travel together because a reader that takes the list alone states as
 * fact something that may never have been observed. Describing an install to an
 * agent is a positive claim, not an access decision: an access decision is
 * right to treat an unreachable registry as the empty set, and a description
 * that did the same would tell the agent this install has no content.
 */
export interface ReadableContent {
  entities: ReadableContentEntity[];
  /**
   * False when a registry could not be enumerated, so `entities` is a FLOOR:
   * everything in it is readable, and there may be more that went unseen.
   */
  complete: boolean;
}

/**
 * The caller in the shape the per-entity decision reads.
 *
 * One conversion for both entry points below, so the set and the single answer
 * cannot be resolved from different views of the same caller.
 */
function asReadAccess(caller: ReadableContentCaller) {
  return readAccessCaller({
    user: { id: caller.user.id, roles: caller.user.roles },
    ...(caller.authenticatedScope
      ? { authenticatedScope: caller.authenticatedScope }
      : {}),
  });
}

/**
 * @public What this caller may know about ONE named entity.
 *
 * Both facts from one registry lookup: whether the install registers the slug
 * at all, and whether this caller may read it. Answered together because every
 * surface that asks needs both, and asking separately costs a second lookup for
 * the same name and gives the two facts a second place to be composed
 * differently.
 *
 * A POINT lookup rather than an enumeration. A caller walking the entities
 * {@link readableContent} just listed would otherwise scan both registries once
 * per entity: the whole registry read N times to answer N questions that each
 * name one slug.
 *
 * FOUR states, and they are not interchangeable:
 *
 * - registered and readable: `kind` is set, `readable` is true, `known` true.
 * - registered and WITHHELD: `kind` is set, `readable` is false. The entity
 *   exists and this caller may not see it.
 * - UNREGISTERED: `kind` is absent and `known` is true. Neither registry
 *   answers to the name, so there is no rule to judge it against.
 * - UNKNOWN: `kind` is absent and `known` is FALSE. A lookup threw, so the
 *   slug's absence was never established. A caller that reads this as
 *   unregistered has chosen a failure direction by accident, and for a
 *   disclosure decision it is the unsafe one.
 *
 * 🔴 The three-way is for a caller deciding what to DISCLOSE, never for one
 * deciding how to answer a request. A refusal that separated "you may not read
 * this" from "no such entity" lets a caller map an install by asking about
 * guesses, which is why {@link readableContentKind} collapses both to
 * `undefined` and why anything answering a request should ask that instead.
 *
 * What it IS for: a description that names one entity from inside another. A
 * relationship field carries its target collection, and forwarding that name
 * discloses a withheld collection's existence — while a target that is not a
 * registered content entity at all, `users` or the media library, discloses
 * nothing about the install's content and must not be stripped. Readability
 * alone cannot separate those two, and redacting on it removes both.
 */
export interface ContentReadability {
  /** The registry that owns the slug; absent when neither does, or none could answer. */
  kind?: ReadableContentEntity["kind"];
  /** Whether this caller may read it. Always false when it is not registered. */
  readable: boolean;
  /**
   * Whether the registries answered at all.
   *
   * False when a lookup threw. `kind` is then absent because the answer is
   * unknown, NOT because the slug is unregistered, and the two have opposite
   * safe responses: refuse the read, and withhold the name.
   */
  known: boolean;
}

export async function contentReadability(
  slug: string,
  caller: ReadableContentCaller
): Promise<ContentReadability> {
  const { kind, known } = await registeredContentKindOf(slug);
  // A slug with no registry entry is not judged. It has no rule to decide
  // against, and admitting what cannot be judged is the inversion the
  // dashboard's readable-resources endpoint was fixed to remove. Asking anyway
  // would also let a super admin's bypass, which short-circuits before it reads
  // any rule, answer yes for a slug that exists nowhere. An unknown answer
  // takes the same branch and is reported as unknown, so a caller can tell.
  if (kind === undefined) return { readable: false, known };
  return {
    kind,
    readable: await entityReadableOrDenied(slug, caller),
    known,
  };
}

/**
 * The read decision for one entity, with a REJECTED decision read as denied.
 *
 * 🔴 The direction matters more than the failure. `canReadEntity` rejects when
 * the permission store cannot answer — an unavailable database, a pool with no
 * connection left — and letting that reject propagate makes the two ways of
 * being unavailable distinguishable from OUTSIDE: a registered slug answers
 * with an internal error while an unregistered one still gets the uniform
 * refusal, so a caller learns an entity exists by watching how the failure is
 * spelled. The whole point of collapsing both into `undefined` in
 * {@link readableContentKind} is that it must not be learnable.
 *
 * The registry kind is kept, because it was established before the decision was
 * asked and a disclosure caller still needs it: a target that is registered and
 * unreadable is WITHHELD, and folding it into "not registered" would publish
 * the slug this exists to hide.
 *
 * Denied rather than admitted is the same direction {@link readableEntities}
 * takes for the set, where a rejected decision inside `Promise.allSettled`
 * drops the slug: a check that threw has told us nothing, and nothing must not
 * read as allowed.
 */
async function entityReadableOrDenied(
  slug: string,
  caller: ReadableContentCaller
): Promise<boolean> {
  try {
    return await canReadEntity(slug, asReadAccess(caller));
  } catch {
    return false;
  }
}

/**
 * @public Which kind of entity this is, if the caller may read it at all.
 *
 * The answer anything SERVING a request should ask, because it collapses the
 * two ways of being unavailable into one. A caller able to tell "not permitted"
 * from "no such entity" can map an install's entities by asking about guesses,
 * and the two have the same consequence for a request anyway.
 *
 * A tool reading a collection also has to know it is not a single: the two are
 * read through different services, so a caller that guesses sends the read to a
 * path that cannot answer and gets a not-found in place of the refusal it
 * should have had.
 *
 * Derived from {@link contentReadability} rather than answered separately. Two
 * functions asking one question is how they come to disagree, and the narrower
 * view is the one to derive — which also keeps this in step with
 * {@link readableContent}, since a caller allowed by one and refused by the
 * other is exactly the drift these share a module to prevent.
 */
export async function readableContentKind(
  slug: string,
  caller: ReadableContentCaller
): Promise<ReadableContentEntity["kind"] | undefined> {
  const { kind, readable } = await contentReadability(slug, caller);
  return readable ? kind : undefined;
}

/**
 * @public Whether this caller may read ONE named entity.
 *
 * The same decision {@link readableContent} takes per entity, for a caller that
 * already knows which entity it is asking about and should not pay for the
 * whole set to find out.
 *
 * Derived from {@link readableContentKind} rather than answered separately: two
 * functions asking one question is how they come to disagree, and the narrower
 * view is the one to derive.
 */
export async function canReadContent(
  slug: string,
  caller: ReadableContentCaller
): Promise<boolean> {
  return (await readableContentKind(slug, caller)) !== undefined;
}

/**
 * @public Which collections and singles this caller may read.
 *
 * Coarse only in WHAT it decides: whether an entity is in reach at all. The
 * per-row rules of whatever query follows still decide which documents come
 * back, and the field-level rules still decide which of their fields do.
 *
 * The kind travels with the slug because a Single is read through its own
 * service. A caller holding the slug alone has to guess, and guessing sends the
 * read to a path that cannot answer about it.
 *
 * Order follows the registry rather than the permission store, so the answer is
 * stable across calls for a caller whose grants did not change.
 */
export async function readableContent(
  caller: ReadableContentCaller
): Promise<ReadableContent> {
  const { kinds, degraded } = await registeredContentSnapshot();
  const allowed = await readableEntities(
    [...kinds.keys()],
    asReadAccess(caller)
  );
  return {
    entities: [...kinds.entries()]
      .filter(([slug]) => allowed.has(slug))
      .map(([slug, kind]) => ({ slug, kind })),
    complete: !degraded,
  };
}
