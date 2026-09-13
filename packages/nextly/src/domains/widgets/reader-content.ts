/**
 * What content THIS reader can see, asked once and shared.
 *
 * Two questions, and they are kept apart on purpose. Which collections and
 * singles the reader HAS -- what the `collections:present` and
 * `singles:present` conditions gate the management cards on, and what the
 * onboarding steps tick -- is the registries' own readable listing, the same
 * one the list endpoints scope their rows by, so a card and the condition that
 * offers it describe one set. Which of those a widget may QUERY is narrower:
 * an entity whose stored shape is known to be ahead of its table has no
 * source, and a read of it would throw. The content questions walk only the
 * second set, so an install whose one collection is mid-migration is told it
 * has a collection and no content, rather than nothing at all.
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

import { callerMayPerform } from "../../auth/authenticated-scope";
import {
  authorizationGroups,
  readAccessCaller,
} from "../../auth/entity-read-access";
import { getService } from "../../di";
import { requireNextly } from "../../direct-api/nextly";
import type { FindArgs } from "../../direct-api/types/collections";
import type { ReadCaller } from "../../services/dashboard/readable-resources";
import { readableSlugAllowlist } from "../../services/lib/readable-slug-allowlist";
import { resolveSingleForRequest } from "../singles/services/ensure-runtime-table";

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
 * Of the reader's collections or singles, the ones a widget may QUERY.
 *
 * A published `collection:` or `single:` source is what says an entity's
 * stored shape is not known to be ahead of its table: the source builders
 * withhold one whose DDL a reload refused, and one whose migration label
 * declines to claim the table. A read of an entity outside this set may throw
 * -- the table can be absent -- and a condition that throws goes unanswered,
 * which HIDES its widget; so the walks below stay inside it, and a fresh
 * install whose one collection is mid-migration keeps its onboarding card.
 */
function queryableSlugs(
  kind: "collection" | "single",
  readable: readonly string[]
): string[] {
  const published = new Set(
    listSources()
      .filter(source => sourceKindFromId(source.id) === kind)
      .map(source => sourceTarget(source.id))
  );
  return readable.filter(slug => published.has(slug));
}

/**
 * Whether this reader can see any collection entry at all.
 *
 * SHORT-CIRCUITS on the first collection holding a row, so the expensive shape
 * — many collections — is the one that returns soonest, and the exhaustive walk
 * happens only on an install that is genuinely empty, where every count is
 * against an empty table.
 *
 * Asked per collection through the ordinary counted read rather than through
 * one unscoped total, because "any entry" has to mean "any entry THIS reader
 * may read": a total taken with the guard off would answer from rows the
 * reader is not allowed to know exist.
 *
 * `status: "all"` because a draft is content. A reader who has written one post
 * and not published it is not looking at an empty install, and telling them
 * they are is the onboarding equivalent of losing their work.
 */
export async function readerHasEntries(
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
  const slugs = queryableSlugs(
    "collection",
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

/** The two stored instants a save is told apart by, under their column names. */
interface StoredInstants {
  created_at?: unknown;
  updated_at?: unknown;
}

/**
 * Whether a single's row has been written since it was created.
 *
 * Both columns are timestamps on every dialect, so both arrive as `Date`s; a
 * value that is not one is not a write this can see.
 */
function writtenSinceCreated(row: StoredInstants): boolean {
  return (
    row.created_at instanceof Date &&
    row.updated_at instanceof Date &&
    row.updated_at.getTime() > row.created_at.getTime()
  );
}

/**
 * Whether any single this reader may read has been SAVED.
 *
 * Saved rather than present, because a single's row is created with its
 * defaults the first time anything reads it: the singles read path answers a
 * missing document by creating it. Counted on existence, every install whose
 * template defines a single would stop being empty the moment its dashboard
 * or its singles screen was opened.
 *
 * A save is told apart by its timestamps. The default row is stamped with ONE
 * instant for both, and every write stamps `updated_at` afresh, so a later
 * `updated_at` means a write. The limit is the columns' precision: SQLite and
 * MySQL keep whole seconds, so a first write that creates the row itself
 * within the same second reads as unsaved until the next write. A save made in
 * the admin is never that write, because opening the single to edit it is
 * what created the row.
 *
 * Read from the table rather than through the singles read path, which would
 * create the row it could not find and turn every dashboard load into a write
 * per single. The table is opened the way the request-scoped single services
 * open it, so a process that has not registered it yet still can.
 *
 * SHORT-CIRCUITS on the first saved single, for the reason the entry walk does.
 */
export async function readerHasSavedSingle(
  caller: ReadCaller,
  /** The reader's singles, when the caller already has them. */
  resolved?: readonly string[]
): Promise<boolean> {
  const slugs = queryableSlugs(
    "single",
    resolved ?? (await readableSingleSlugs(caller))
  );
  if (slugs.length === 0) return false;

  const adapter = getService("adapter");
  const registry = getService("singleRegistryService");
  const logger = getService("logger");
  for (const slug of slugs) {
    const single = await resolveSingleForRequest(
      adapter,
      registry,
      slug,
      logger
    );
    if (!single) continue;
    const row = await adapter.selectOne<StoredInstants>(single.tableName, {
      columns: ["created_at", "updated_at"],
    });
    if (row && writtenSinceCreated(row)) return true;
  }

  return false;
}
