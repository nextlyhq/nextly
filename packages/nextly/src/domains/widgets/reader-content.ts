/**
 * What content THIS reader can see, asked once and shared.
 *
 * Two callers ask a version of this question — the `content:empty` condition
 * and the onboarding steps — and they must not answer it twice. A second
 * implementation would agree on the day it was written and drift afterwards,
 * silently, because both would look correct in isolation: one counting drafts
 * and the other not, or one reading the source registry and the other the
 * collections registry, produces a dashboard that offers an onboarding card
 * while telling the reader their install has content.
 *
 * Its own module rather than a helper inside either caller, because the two
 * import each other's neighbours: the condition evaluator names the onboarding
 * answer, and the onboarding answer needs this counting. A shared leaf has no
 * cycle to break.
 *
 * @module domains/widgets/reader-content
 */

import {
  readableEntities,
  readAccessCaller,
} from "../../auth/entity-read-access";
import { requireNextly } from "../../direct-api/nextly";
import type { FindArgs } from "../../direct-api/types/collections";
import type { ReadCaller } from "../../services/dashboard/readable-resources";

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
 * Taken from the WIDGET SOURCE registry rather than the collections registry
 * directly. That registry excludes a collection whose stored metadata is known
 * to be ahead of its table — a transient reload state — so such a collection is
 * not counted here.
 *
 * Accepted, because the alternative is worse in the case this exists for.
 * Reading straight from the collections registry would query tables that may
 * not exist yet; that count throws, the condition goes unanswered, and an
 * unanswered condition HIDES its widget — so the onboarding card would
 * disappear on exactly the fresh install it is meant to greet.
 *
 * Note what is NOT a gap: a `pending` migration status does not drop a
 * collection. The source builder treats that label as a fast path only and asks
 * the database whether the table exists when the label declines.
 */
export async function readableCollectionSlugs(
  caller: ReadCaller
): Promise<string[]> {
  const slugs = listSources()
    .filter(source => sourceKindFromId(source.id) === "collection")
    .map(source => sourceTarget(source.id));

  // Asked once for the whole set rather than per collection: a permission
  // decision resolves a session caller through a per-user TTL cache, so asking
  // separately is one database read per collection for one answer.
  const readable = await readableEntities(slugs, readAccessCaller(caller));
  return slugs.filter(slug => readable.has(slug));
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
export async function readerHasContent(caller: ReadCaller): Promise<boolean> {
  const slugs = await readableCollectionSlugs(caller);

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
