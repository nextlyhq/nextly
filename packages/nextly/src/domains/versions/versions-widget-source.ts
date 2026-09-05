/**
 * `system:versions` — the documents carrying edits that are not live.
 *
 * 🔴 The access decision is made HERE, and that is the difference from
 * `system:releases`. `ReleasesService` authorizes itself, so that resolver
 * hands the caller through and adds nothing. `VersionsService` has no
 * authorization at all — none of its methods takes an actor — so a resolver
 * that simply called it would answer an install-wide number to a reader
 * entitled to part of it.
 *
 * Authorization here has TWO axes, and each is load-bearing. The first decides
 * which collections are in reach; the second decides which of their documents
 * are, and stopping at the first is what made this card disclose one author's
 * work to another.
 *
 * **Which collections.** `readableEntities`, asked once per registered entity,
 * and NOT a filter over the caller's permission slugs. The two look equivalent
 * and are not, in both directions:
 *
 * - An API key is judged on its OWN stamped scope. Resolving the owner's
 *   role-derived slugs instead hands a narrowly scoped key everything its
 *   minter can read — and a key minted by a super admin every document in the
 *   install, since the bypass belongs to the session path alone.
 * - A collection whose code-defined `access.read` REFUSES this caller still has
 *   the permission row a slug filter admits it on, and one authorized purely in
 *   code has no row to find at all.
 *
 * That is the same call `/api/dashboard/stats` and the widget layout endpoint
 * make, so this card describes the collections whose documents the caller could
 * actually open — which is the only definition of "in reach" that cannot drift
 * from what a row read would answer.
 *
 * The result is an ENUMERATED set, never "no filter". A super admin gets every
 * registered entity rather than an unbounded read, so a version row naming a
 * collection that is no longer registered belongs to nobody — the same
 * deliberate consequence `resolveReadableResources` documents. It is what lets
 * the service take a required `readonly string[]`, with `[]` meaning exactly
 * nothing, instead of the three-way `undefined | [] | list` whose collapse hands
 * every document to a caller granted none.
 *
 * **Which documents.** `readableEntities` is coarse BY CONTRACT — it says
 * whether an entity is in reach at all, and leaves the per-row rules of the
 * query that follows to decide what comes back. A collection carrying a stored
 * `owner-only` or `custom` read rule therefore admits every editor at that
 * check while the ordinary read path narrows to a subset, and a version query
 * filtered by collection name alone counted and listed the documents in
 * between: other authors' entry ids, their languages, and when they last
 * touched them. `visiblePendingEdits` closes it by asking the ordinary read
 * path which of the candidate documents survive, rather than reproducing a rule
 * that may be an arbitrary function.
 *
 * @module domains/versions/versions-widget-source
 */

import {
  readAccessCaller,
  readableEntities,
} from "../../auth/entity-read-access";
import { container } from "../../di/container";
import { NextlyError } from "../../errors/nextly-error";
import type { ReadCaller } from "../../services/dashboard/readable-resources";
import type { WidgetQuery } from "../widgets/query";
import type { WidgetResult, WidgetResultField } from "../widgets/result";
import { failUnavailableSourceOrOp } from "../widgets/sources";
import { VERSIONS_SOURCE_ID } from "../widgets/system-source-ids";
import { registerSystemSource } from "../widgets/system-sources";

import {
  resolvePendingEditScope,
  visiblePendingEdits,
  type PendingEditScope,
} from "./pending-edit-visibility";
import {
  documentKey,
  newestPerDocument,
  type PendingEditCursor,
  type PendingEditOrder,
  type VersionMeta,
} from "./versions-repository";
import type { VersionsService } from "./versions-service";

export { VERSIONS_SOURCE_ID };

/** How many rows the list card draws when the query names no limit. */
const DEFAULT_LIMIT = 5;

/**
 * How many ROWS a count may read before it answers with a floor.
 *
 * 🔴 Rows, not documents, and bounded on the CALLER's own work. The bound used
 * to be a pre-authorization count of candidate documents, which made one
 * caller's card depend on data they cannot see: a collection accumulating other
 * people's drafts past the threshold broke every owner's dashboard, and whether
 * a caller received a number or a failure disclosed which side of it that unseen
 * population sat on.
 *
 * Reaching it is not a failure. The count says `atLeast` and the card renders
 * `N+` — a reader learns the scale, and nothing claims to be whole that is not.
 * Every mechanism that tried to preserve exactness past a bound instead produced
 * a wrong answer: a document quota could not tell "exactly this many" from "more
 * than this many", and a shortcut on documents already seen conflated meeting a
 * document with deciding it, since authorization is per language.
 *
 * 🔴 A KNOWN, ACCEPTED disclosure lives here, recorded so nobody has to
 * rediscover it and nobody removes it believing it accidental. `atLeast` is set
 * when this budget binds, and the budget counts RAW rows — so whether a caller
 * sees `5` or `5+` depends on how many draft rows exist in the collections they
 * can reach, their colleagues' included. One bit, about total VOLUME: never
 * which documents, whose, or when they were touched, which is what the
 * pre-`visiblePendingEdits` card exposed.
 *
 * It is not removable while any bound exists, and that is the whole argument.
 * The budget is here to bound WORK, work is raw rows, and any flag derived from
 * a bound on unfiltered data is a fact about unfiltered data. Deriving it from
 * the visible set instead means having no bound at all, so one dashboard load
 * on a large install walks the entire pending-edit index — a self-inflicted
 * denial of service on a page every session opens, traded for one bit.
 *
 * Nor does the index make the bound cheap enough to raise out of reach. The
 * page-level cost is not the row read: each page also asks the ordinary read
 * path which of its documents survive, once per slug and language, and THOSE
 * scale with the number of pages. Raising this multiplies the authorization
 * round trips behind every dashboard, which is the cost the number was chosen
 * against.
 *
 * The general fix is to let the database apply the access rule itself, as
 * Payload and Directus do — exact, cheap and leak-free. It needs the version
 * row to carry or join the fields a rule names, and a `custom` rule is an
 * arbitrary function that cannot be pushed down at all, so it closes the common
 * case and not this one. Its own piece of work, not a patch here.
 */
const COUNT_ROW_BUDGET = 2000;

/**
 * How many rows a LIST reads before answering with what it has.
 *
 * Much smaller, because a card wants a handful of rows and the ordinary install
 * — where nothing is filtered — fills it from the first page. A list that comes
 * back short under heavy filtering is a thin card, never a wrong one.
 */
const LIST_ROW_BUDGET = 400;

/**
 * Rows read per round.
 *
 * A document contributes one row per language, and rows a stored rule hides
 * contribute none, so how many rows a page of DOCUMENTS costs is not knowable in
 * advance. Rounds make that unnecessary; this only has to be large enough that
 * the ordinary install finishes in one.
 */
const ROW_PAGE = 100;

/**
 * The fields this source publishes.
 *
 * Deliberately the document's identity and its instant, and nothing from the
 * snapshot: a source's field list is the allowlist every query is checked
 * against, so publishing a column here publishes it to every reader who may see
 * the source. The snapshot is the document's unpublished content.
 */
const VERSION_FIELDS = [
  { name: "scopeSlug", type: "string" as const, label: "Collection" },
  { name: "entryId", type: "string" as const, label: "Document" },
  { name: "locale", type: "string" as const, label: "Language" },
  { name: "updatedAt", type: "date" as const, label: "Edited" },
];

function service(): VersionsService {
  if (!container.has("versionsService")) {
    throw NextlyError.internal({
      logContext: { reason: "versions-service-unregistered" },
    });
  }
  return container.get<VersionsService>("versionsService");
}

/**
 * What this source does with each field of a widget query.
 *
 * Exhaustive over `keyof WidgetQuery`, so adding a field there fails
 * `check-types` here until someone decides what it means for this source —
 * rather than the field being accepted by validation and then silently dropped,
 * which answers a different question than the caller asked.
 */
const QUERY_FIELD_USE: Record<keyof WidgetQuery, "consumed" | "refused"> = {
  source: "consumed",
  op: "consumed",
  select: "consumed",
  limit: "consumed",
  where: "refused",
  sort: "refused",
  status: "refused",
};

function refuseUnconsumed(query: WidgetQuery): void {
  const carried = Object.entries(query)
    .filter(
      ([name, value]) =>
        value !== undefined &&
        QUERY_FIELD_USE[name as keyof WidgetQuery] === "refused"
    )
    .map(([name]) => name);
  if (carried.length > 0) {
    failUnavailableSourceOrOp(
      `source "${VERSIONS_SOURCE_ID}" answers a fixed question and cannot honour: ${carried.join(", ")}`
    );
  }
}

/** A version row reduced to the fields this source declares. */
function projected(
  row: {
    scopeSlug: string;
    entryId: string;
    locale: string | null;
    updatedAt: Date;
  },
  names: readonly string[]
): Record<string, unknown> {
  const full: Record<string, unknown> = {
    scopeSlug: row.scopeSlug,
    entryId: row.entryId,
    locale: row.locale,
    updatedAt: row.updatedAt,
  };
  return Object.fromEntries(names.map(name => [name, full[name]]));
}

/**
 * The fields to answer with, in the order the query asked for them.
 *
 * 🔴 Order comes from `select`, not from `VERSION_FIELDS`. The table archetype
 * draws its columns straight off `WidgetResult.fields`, so rebuilding the list
 * in declaration order renders `select: ["updatedAt", "scopeSlug"]` as
 * Collection then Edited — the reverse of what its author wrote, with nothing
 * anywhere reporting a disagreement. The collection path derives it this way
 * for the same reason.
 *
 * Unknown names are dropped rather than refused, because the source's field list
 * is the allowlist every query is checked against and a name outside it has no
 * value to answer with. Duplicates are collapsed first: `["title", "title"]` is
 * a legal selection whose projection is one value, so emitting two descriptors
 * would have a table draw two columns for it.
 */
function selectedNames(query: WidgetQuery): string[] {
  if (!query.select?.length) return VERSION_FIELDS.map(field => field.name);
  return [
    ...new Set(
      query.select.filter(name =>
        VERSION_FIELDS.some(field => field.name === name)
      )
    ),
  ];
}

/** Each selected name paired with the label this source publishes for it. */
function describe(names: readonly string[]): WidgetResultField[] {
  // Type as well as label. The renderer presents a value by its declared kind,
  // so a describer that publishes only the label leaves `updatedAt` to be
  // printed as the ISO string it crossed the wire as.
  const declared = new Map(VERSION_FIELDS.map(field => [field.name, field]));
  return names.map(name => {
    const field = declared.get(name);
    return {
      name,
      ...(field?.label !== undefined && { label: field.label }),
      ...(field?.type !== undefined && { type: field.type }),
    };
  });
}

/**
 * Up to `wanted` DOCUMENTS the caller may see, newest first.
 *
 * 🔴 The order is the correctness property. Rows are read, then AUTHORIZED, and
 * only then collapsed to one per document — because a localized Single is
 * authorized per language while a document is one thing to publish across all of
 * them. Collapsing first offers the visibility filter each document's newest
 * locale alone, so a document whose newest pending locale is denied disappears
 * even when an older locale is readable and the reader is entitled to it.
 *
 * `exhausted` says whether the table ran out rather than the rounds. A count may
 * only be published when it did: otherwise the answer is a floor, and a metric
 * that quietly under-reports is the failure this whole source was repaired for.
 */
/** What a walk has accumulated so far, across its rounds. */
interface Gathered {
  documents: VersionMeta[];
  /** Documents already kept, so one split across a page cannot appear twice. */
  seen: Set<string>;
}

/**
 * Fold one page's authorized rows into `gathered`; true when it is full.
 *
 * The collapse runs per round against what is already kept rather than over the
 * whole walk at the end, so a document drafted in several languages across a
 * page boundary is still counted once.
 */
function absorbPage(
  gathered: Gathered,
  visible: readonly VersionMeta[],
  wanted: number
): boolean {
  for (const row of newestPerDocument(visible, Number.MAX_SAFE_INTEGER)) {
    const key = documentKey(row);
    if (gathered.seen.has(key)) continue;
    gathered.seen.add(key);
    gathered.documents.push(row);
    if (gathered.documents.length >= wanted) return true;
  }
  return false;
}

/**
 * Walk pending-edit rows, authorizing each page, until `wanted` documents are
 * found or `rowBudget` rows have been read.
 *
 * 🔴 `exhausted` means the ROWS ran out — nothing else. Earlier versions tried
 * to conclude it sooner, and each shortcut was wrong in its own way: stopping at
 * a document quota could not tell "exactly this many" from "more than this
 * many", and stopping once every candidate had been MET conflated seeing a
 * document with deciding it. Authorization is per LANGUAGE, so a document first
 * met through a locale it is denied in may still be readable in a locale that
 * has not been read yet — and a walk that stopped there reported zero for a set
 * the caller could see entirely.
 */
async function gatherVisibleDocuments(
  wanted: number,
  rowBudget: number,
  order: PendingEditOrder,
  readableSlugs: readonly string[],
  caller: ReadCaller,
  scope: PendingEditScope
): Promise<{ documents: VersionMeta[]; exhausted: boolean }> {
  const gathered: Gathered = { documents: [], seen: new Set() };
  let after: PendingEditCursor | undefined;
  let read = 0;

  while (read < rowBudget) {
    const want = Math.min(ROW_PAGE, rowBudget - read);
    const rows = await service().pendingEditRows({
      readableSlugs,
      order,
      limit: want,
      ...(after ? { after } : {}),
    });
    if (rows.length === 0) {
      return { documents: gathered.documents, exhausted: true };
    }
    read += rows.length;
    // Anchored to the LAST row of this page, in the order it was read.
    const last = rows[rows.length - 1];
    after = { updatedAt: last.updatedAt, id: last.id };

    const visible = await visiblePendingEdits(rows, caller, scope);
    if (absorbPage(gathered, visible, wanted)) {
      return { documents: gathered.documents, exhausted: false };
    }
    // A short page is the end of the rows, not the end of this round.
    if (rows.length < want) {
      return { documents: gathered.documents, exhausted: true };
    }
  }

  return { documents: gathered.documents, exhausted: false };
}

async function resolveVersions(
  query: WidgetQuery,
  caller: ReadCaller
): Promise<WidgetResult> {
  refuseUnconsumed(query);

  // Resolved ONCE per query and passed down, rather than each read asking
  // again: the two ops answer about the same set, and two resolutions of one
  // caller's permissions are two chances to disagree.
  //
  // 🔴 The candidate slugs come from the SAME snapshot the per-page visibility
  // pass is judged against, so one query cannot be bounded by one enumeration
  // of the registry and then filtered by another. Two reads can disagree — a
  // collection registered between them is in the second and not the first —
  // and the rows in between would be decided by a set that never bounded them.
  const scope = await resolvePendingEditScope();
  if (scope.degraded) {
    // A registry that could not be enumerated makes every answer here a floor
    // with nothing to say so. `0` would be a positive claim about documents
    // this never managed to look for, and reporting a failure is the honest
    // form of "not known" -- the grid renders one per card, so the rest of the
    // dashboard still draws.
    throw NextlyError.internal({
      logContext: { reason: "content-registry-unreachable" },
    });
  }
  const readableSlugs = [
    ...(await readableEntities(
      [...scope.kinds.keys()],
      readAccessCaller(caller)
    )),
  ];

  if (query.op === "count") {
    // 🔴 No pre-authorization aggregate decides anything here any more. Counting
    // candidates before the row rules narrow them made the answer depend on data
    // the caller cannot see: one collection accumulating other people's drafts
    // past the bound broke every owner's card, and whether a caller got a number
    // or a failure disclosed which side of the threshold that unseen population
    // sat on. The walk is bounded by ROWS it reads, which is the caller's own
    // work and nobody else's.
    const { documents, exhausted } = await gatherVisibleDocuments(
      Number.MAX_SAFE_INTEGER,
      COUNT_ROW_BUDGET,
      // By IDENTITY, because a count needs to ENUMERATE rather than to rank, and
      // an id cannot be outrun by the rows being enumerated.
      "identity",
      readableSlugs,
      caller,
      scope
    );
    return {
      op: "count",
      total: documents.length,
      // Said plainly rather than refused or quietly truncated. A reader learns
      // the scale, the card renders `N+`, and nothing claims to be whole that
      // is not.
      ...(exhausted ? {} : { atLeast: true as const }),
    };
  }

  const limit = query.limit ?? DEFAULT_LIMIT;
  const rows = (
    await gatherVisibleDocuments(
      limit,
      LIST_ROW_BUDGET,
      // By RECENCY, because "recently edited" is what the card means. A row
      // saved mid-walk can move ahead of the cursor and be missed, which for a
      // point-in-time list of the newest few is an ordinary consequence of
      // reading a moving set -- and is why the COUNT does not order this way.
      "recency",
      readableSlugs,
      caller,
      scope
    )
  ).documents;
  const names = selectedNames(query);
  const fields = query.select?.length ? describe(names) : undefined;

  return {
    op: "list",
    items: rows.map(row => projected(row, names)),
    ...(fields?.length ? { fields } : {}),
  };
}

/**
 * Publish the source and the function that answers it.
 *
 * `supports` names both ops because both are genuinely answerable: the count is
 * one aggregate over the versions table, and the list is one bounded read of
 * the same set. That is why this source is worth its own kind rather than being
 * two unrelated cards.
 */
export function registerVersionsWidgetSource(): void {
  registerSystemSource(
    {
      id: VERSIONS_SOURCE_ID,
      label: "Pending edits",
      kind: "system",
      supports: ["count", "list"],
      fields: VERSION_FIELDS,
    },
    resolveVersions
  );
}
