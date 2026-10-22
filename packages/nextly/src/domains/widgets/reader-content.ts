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

import { callerMayPerform } from "../../auth/access/route-gate-adapters";
import {
  AUTHORIZATION_CONCURRENCY,
  authorizationGroups,
  readAccessCaller,
} from "../../auth/entity-read-access";
import { requireNextly } from "../../direct-api/nextly";
import type { FindArgs } from "../../direct-api/types/collections";
import type { ReadCaller } from "../../services/dashboard/readable-resources";
import { readableSlugAllowlist } from "../../services/lib/readable-slug-allowlist";

import { isKeptOffDashboard } from "./kept-off-dashboard";
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
  const readable =
    (await readableSlugAllowlist(readAccessCaller(caller), "collection")) ?? [];
  // A collection kept off the dashboard does not make a content card worth offering: the card
  // would leave it out and draw empty.
  return readable.filter(slug => !isKeptOffDashboard("collection", slug));
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
  const readable =
    (await readableSlugAllowlist(readAccessCaller(caller), "single")) ?? [];
  // Kept off the dashboard, for the reason the collections' are.
  return readable.filter(slug => !isKeptOffDashboard("single", slug));
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
 * 🔴 Decided through {@link callerMayPerform}, not through the bare permission
 * check beside it. For a scoped API KEY the two disagree: the bare check reads
 * the stamped grant and stops, while a real write also evaluates the
 * collection's code-defined `access.create` against that scope. A key stamped
 * `create-<slug>` whose code rule refuses it would therefore have been told it
 * may create -- and the step it was offered is refused by the write, which is
 * the defect this predicate exists to prevent, wearing a different hat.
 *
 * Short-circuits on the first grant, and walks in {@link authorizationGroups}
 * order otherwise: one decision, then bounded groups, so a cold per-user cache
 * is populated once rather than missed by every member of the first fan-out.
 */
export async function readerMayCreateEntry(
  caller: ReadCaller,
  readable: readonly string[]
): Promise<boolean> {
  for (const group of authorizationGroups(readable)) {
    // `allSettled`, as the read decision beside it: a lookup that threw has
    // told us nothing, and nothing must not read as a grant. The slug counts
    // as refused and the rest of the set still answers.
    const settled = await Promise.allSettled(
      group.map(slug =>
        callerMayPerform(caller.authenticatedScope, "create", slug, caller.user)
      )
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
export function queryableCollectionSlugs(
  readable: readonly string[]
): string[] {
  const published = new Set(
    listSources()
      .filter(source => sourceKindFromId(source.id) === "collection")
      .map(source => sourceTarget(source.id))
  );
  return readable.filter(slug => published.has(slug));
}

/**
 * How long the content check may take before it answers "unknown".
 *
 * Five seconds: long enough for a few rounds of counts on a slow database, and
 * short enough that a dashboard waiting on it is not mistaken for a hung one.
 * Past it the answer is honestly not known, and "not known" must never read as
 * "empty" -- telling a reader with content that their install is empty is the
 * onboarding equivalent of losing their work.
 */
export const CONTENT_CHECK_BUDGET_MS = 5_000;

/** What the content check can say: found some, found none, or ran out of time to know. */
export type ContentAnswer = boolean | "unknown";

/**
 * Whether this reader can see any content at all.
 *
 * Counted CONCURRENTLY, at most {@link AUTHORIZATION_CONCURRENCY} collections at
 * once (the bound the read decisions before it keep), and stops starting counts
 * at the first collection holding a row. On an install with content that is the
 * first round; only a genuinely empty install counts every collection, and then
 * against empty tables. All inside {@link CONTENT_CHECK_BUDGET_MS}: an answer
 * not reached by then is "unknown", which every reader of this treats as not
 * empty. A Direct API count takes no signal, so a count already running when
 * the check stops cannot be cancelled: it finishes, and its answer is ignored.
 *
 * Asked per collection through the ordinary counted read rather than through
 * one unscoped total, because "any content" has to mean "any content THIS
 * reader may read": a total taken with the guard off would answer from rows the
 * reader is not allowed to know exist.
 *
 * `status: "all"` because a draft is content. A reader who has written one post
 * and not published it is not looking at an empty install, and telling them
 * they are is the onboarding equivalent of losing their work.
 *
 * A count that FAILS fails the check, as it did when the counts ran one after
 * another: nothing is known about that collection, and guessing either way
 * would be wrong.
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
): Promise<ContentAnswer> {
  const slugs = queryableCollectionSlugs(
    resolved ?? (await readableCollectionSlugs(caller))
  );
  return anyHoldsEntry(slugs, async slug => {
    const { total } = await requireNextly().count({
      collection: slug,
      status: "all",
      ...readArgs(caller),
    });
    return total;
  });
}

/**
 * Whether any of `slugs` holds an entry, by `count`, with at most `limit`
 * counts in flight, answering "unknown" once `budgetMs` has passed.
 *
 * Answers as soon as it knows: the first non-zero count answers `true` without
 * waiting for the counts still in flight, and no count starts after an answer.
 * Its own function so the pool's bound and its stopping can be watched with a
 * count the test controls.
 */
export function anyHoldsEntry(
  slugs: readonly string[],
  count: (slug: string) => Promise<number>,
  limit: number = AUTHORIZATION_CONCURRENCY,
  budgetMs: number = CONTENT_CHECK_BUDGET_MS
): Promise<ContentAnswer> {
  if (slugs.length === 0) return Promise.resolve(false);
  return new Promise<ContentAnswer>((resolve, reject) => {
    let next = 0;
    let inFlight = 0;
    let answered = false;
    const timer = setTimeout(() => answer("unknown"), budgetMs);
    // A check that answered in a millisecond must not hold the process open
    // for the rest of its budget.
    timer.unref?.();

    function answer(value: ContentAnswer): void {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      resolve(value);
    }

    function fail(error: unknown): void {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      // The count's own failure, passed on as it came; a thrown non-Error is
      // wrapped so the caller always rejects with one.
      reject(error instanceof Error ? error : new Error(String(error)));
    }

    function launch(): void {
      while (!answered && inFlight < limit && next < slugs.length) {
        const slug = slugs[next];
        next += 1;
        if (slug === undefined) continue;
        inFlight += 1;
        // Through a resolved promise, so a count that throws as it is called
        // fails the check rather than escaping this loop.
        Promise.resolve()
          .then(() => count(slug))
          .then(total => {
            inFlight -= 1;
            if (total > 0) answer(true);
            else launch();
          }, fail);
      }
      if (!answered && inFlight === 0 && next >= slugs.length) answer(false);
    }

    launch();
  });
}
