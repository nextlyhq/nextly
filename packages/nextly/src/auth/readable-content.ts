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

import { registeredContentSnapshot } from "../services/lib/registered-content-slugs";

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
 * @public Which kind of entity this is, if the caller may read it at all.
 *
 * Answers the registry question and the access question together, because a
 * caller asking about one entity needs both and asking them separately costs a
 * second registry enumeration for the same name. A tool reading a collection
 * has to know it is not a single: the two are read through different services,
 * so a caller that guesses sends the read to a path that cannot answer and gets
 * a not-found in place of the refusal it should have had.
 *
 * `undefined` covers both "not registered" and "not readable", deliberately.
 * A caller able to tell those apart can map an install's entities by asking
 * about guesses, and the two have the same consequence here anyway.
 *
 * An UNREGISTERED slug is refused rather than judged. It has no registry entry
 * and no rule to decide against, and admitting what cannot be judged is the
 * inversion the dashboard's readable-resources endpoint was fixed to remove.
 * That also keeps this in step with {@link readableContent}, which can only
 * ever return registered entities: a caller allowed by one and refused by the
 * other would be exactly the drift these two share a module to prevent.
 */
export async function readableContentKind(
  slug: string,
  caller: ReadableContentCaller
): Promise<ReadableContentEntity["kind"] | undefined> {
  const { kinds } = await registeredContentSnapshot();
  const kind = kinds.get(slug);
  if (kind === undefined) return undefined;
  return (await canReadEntity(slug, asReadAccess(caller))) ? kind : undefined;
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
