/**
 * What content THIS reader can see, asked once and shared.
 *
 * Two questions, and they are kept apart on purpose. Which collections and
 * singles the reader HAS -- what the `collections:present` and
 * `singles:present` conditions gate the management cards on, and what the
 * onboarding steps tick -- is the registries' own readable listing, the same
 * one the list endpoints scope their rows by, so a card and the condition that
 * offers it describe one set. Which of those a widget may QUERY is narrower:
 * a collection whose stored shape is known to be ahead of its table has no
 * source, and a count over it would throw. The content question walks only
 * the second set, so an install whose one collection is mid-migration is told
 * it has a collection and no content, rather than nothing at all.
 *
 * Each question has one implementation here because three callers ask them
 * -- the conditions, the onboarding steps and the dashboard's onboarding
 * endpoint -- and a second copy would agree on the day it was written and
 * drift afterwards: one counting drafts and the other not produces a dashboard
 * that offers an onboarding card while telling the reader their install has
 * content.
 *
 * Its own module rather than a helper inside either caller, because the two
 * import each other's neighbours: the condition evaluator names the onboarding
 * answer, and the onboarding answer needs this counting. A shared leaf has no
 * cycle to break.
 *
 * @module domains/widgets/reader-content
 */

import {
  authorizationGroups,
  callerHoldsPermission,
  readAccessCaller,
} from "../../auth/entity-read-access";
import { requireNextly } from "../../direct-api/nextly";
import type { FindArgs } from "../../direct-api/types/collections";
import type { ReadCaller } from "../../services/dashboard/readable-resources";
import { readableSlugAllowlist } from "../../services/lib/readable-slug-allowlist";

import { listSources, sourceKindFromId, sourceTarget } from "./sources";

/**
 * The access arguments every reader-scoped count here reads through.
 *
 * The SAME shape a widget query uses, so a condition and the cards it governs
 * cannot disagree about who the reader is. `overrideAccess: false` is the whole
 * point: a count taken with the guard off would describe an install rather than
 * a reader.
 */
function readArgs(caller: ReadCaller) {
  return {
    overrideAccess: false as const,
    user: caller.user,
    ...(caller.authenticatedScope
      ? ({ actor: caller.authenticatedScope } satisfies Pick<
          FindArgs<string>,
          "actor"
        >)
      : {}),
  };
}

/**
 * The collections this reader may read, by slug.
 *
 * 🔴 The REGISTRY'S listing, permission-filtered -- `readableSlugAllowlist`,
 * the allowlist the collections list endpoint scopes its rows by -- and not
 * the widget source registry. The sources withhold a collection whose stored
 * metadata is known to be ahead of its table, and one whose migration label
 * declines to claim the table at all; derived from them, this answered "no
 * collections" for an install whose one collection sat `pending` or `failed`,
 * and the management card that would have listed that collection -- the one
 * place a reader could see it needed attention -- was withheld with it. A
 * card that lists registry rows is gated on registry rows.
 */
export async function readableCollectionSlugs(
  caller: ReadCaller
): Promise<string[]> {
  return (
    (await readableSlugAllowlist(readAccessCaller(caller), "collection")) ?? []
  );
}

/**
 * The singles this reader may read, by slug.
 *
 * The same listing as {@link readableCollectionSlugs}, of the other registry,
 * for the same reason: the singles card lists what the singles list endpoint
 * answers, and this is the allowlist that endpoint scopes by.
 */
export async function readableSingleSlugs(
  caller: ReadCaller
): Promise<string[]> {
  return (
    (await readableSlugAllowlist(readAccessCaller(caller), "single")) ?? []
  );
}

/**
 * Whether this reader could create an entry in ANY collection they can read.
 *
 * Answers the grants ALONE: `false` means this reader holds `create-<slug>` on
 * none of the collections named. An empty `readable` is therefore `false` too,
 * and that is not the same statement as "cannot write a first entry" -- with
 * nothing in reach there was no grant to find. The caller composes that case
 * (see `ConditionProbe.mayCreateEntry`, which asks whether they could make a
 * collection instead); answering it here would make this function two questions
 * wearing one name.
 *
 * Decided through {@link callerHoldsPermission}, the same door `requirePermission`
 * uses, so the answer agrees with what the create itself would say. Deriving it
 * from the stored grant rows instead would disagree in both directions, exactly
 * as {@link readableEntities} documents for reads.
 *
 * Short-circuits on the first grant, and walks in {@link authorizationGroups}
 * order otherwise: one decision, then bounded groups, so a cold per-user cache
 * is populated once rather than missed by every member of the first fan-out.
 */
export async function readerMayCreateEntry(
  caller: ReadCaller,
  readable: readonly string[]
): Promise<boolean> {
  const access = readAccessCaller(caller);
  for (const group of authorizationGroups(readable)) {
    // `allSettled`, as the read decision beside it: a lookup that threw has
    // told us nothing, and nothing must not read as a grant. The slug counts
    // as refused and the rest of the set still answers.
    const settled = await Promise.allSettled(
      group.map(slug => callerHoldsPermission(`create-${slug}`, access))
    );
    if (settled.some(result => result.status === "fulfilled" && result.value)) {
      return true;
    }
  }
  return false;
}

/**
 * Of the reader's collections, the ones a widget may QUERY.
 *
 * A published `collection:` source is what says a collection's stored shape is
 * not known to be ahead of its table: the source builder withholds one whose
 * DDL a reload refused, and one whose migration label declines to claim the
 * table. A count over a collection outside this set may throw -- the table
 * can be absent -- and a condition that throws goes unanswered, which HIDES
 * its widget; so the walk below stays inside it, and a fresh install whose one
 * collection is mid-migration keeps its onboarding card.
 */
function queryableCollectionSlugs(readable: readonly string[]): string[] {
  const published = new Set(
    listSources()
      .filter(source => sourceKindFromId(source.id) === "collection")
      .map(source => sourceTarget(source.id))
  );
  return readable.filter(slug => published.has(slug));
}

/**
 * Whether this reader can see any content at all.
 *
 * SHORT-CIRCUITS on the first collection holding a row, so the expensive shape
 * — many collections — is the one that returns soonest, and the exhaustive walk
 * happens only on an install that is genuinely empty, where every count is
 * against an empty table.
 *
 * Asked per collection through the ordinary counted read rather than through
 * one unscoped total, because "any content" has to mean "any content THIS
 * reader may read": a total taken with the guard off would answer from rows the
 * reader is not allowed to know exist.
 *
 * `status: "all"` because a draft is content. A reader who has written one post
 * and not published it is not looking at an empty install, and telling them
 * they are is the onboarding equivalent of losing their work.
 */
export async function readerHasContent(
  caller: ReadCaller,
  /**
   * The reader's collections, when the caller already has them.
   *
   * Optional rather than required so this stays usable on its own, and passed
   * by the condition probe so one layout read resolves the reader's
   * permissions against every collection ONCE rather than per condition.
   */
  resolved?: readonly string[]
): Promise<boolean> {
  const slugs = queryableCollectionSlugs(
    resolved ?? (await readableCollectionSlugs(caller))
  );

  for (const slug of slugs) {
    const { total } = await requireNextly().count({
      collection: slug,
      status: "all",
      ...readArgs(caller),
    });
    if (total > 0) return true;
  }

  return false;
}
