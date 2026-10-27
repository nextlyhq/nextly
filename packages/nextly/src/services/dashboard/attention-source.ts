/**
 * Needs attention's source, `system:attention`: what is waiting for this reader,
 * as one count per kind and, where a kind spans collections, one per part.
 *
 * ## It combines domain reads and owns no rule
 *
 * Each kind is asked of the domain that defines it, as the requesting person:
 *
 * - **Unpublished changes.** A collection's are counted through the entry list's
 *   own `_pendingChange` condition, so the number and the list it links to are
 *   one read. A Single has no list, so Singles come from the versions domain's
 *   pending-edit walk. Both read the working-draft shape the versions repository
 *   defines.
 * - **Due within a week.** Entries a scheduled release will publish, counted
 *   through the entry list's `_inRelease` condition with the week's bound.
 * - **Overdue releases.** The releases domain's own count of its Needs attention
 *   tab narrowed to overdue. "Overdue" is never decided here.
 *
 * ## A part the reader may not read is absent, not zero
 *
 * A collection the reader may not read is never counted; the release kinds are
 * not asked at all of a reader who may not read releases. Kinds and parts with
 * nothing in them are left out too, so a reader barred from releases receives
 * exactly what a reader on a site with no releases due receives, and the card
 * cannot tell either of them what it withheld.
 *
 * ## Bounded work
 *
 * Each collection is counted only up to {@link ATTENTION_COUNT_CAP}, by a read
 * that stops one row past it, and at most {@link ATTENTION_MAX_COLLECTIONS}
 * collections are counted, a few at a time. Past either bound the count is a
 * floor and says so (`atLeast`), and the card shows "N+".
 *
 * ## Language
 *
 * The counts are read with no language named, as the entry list reads, so each
 * number is read in the language the list it links to opens in.
 *
 * ## The digest
 *
 * Asked with `op: "list"`, the source answers the attention digest instead: one
 * item per thing waiting, each with its severity and link, read by the digest's
 * own runner (`domains/widgets/attention/digest`). Its core kinds are releases
 * that stopped and overdue releases, both critical and both the releases
 * domain's own counts; plugins' items follow as warnings. Unpublished changes
 * and entries publishing this week are not in it: they belong to the Content
 * table and Upcoming releases. The grouped answer above stays as it is for the
 * card that reads it today.
 *
 * @module services/dashboard/attention-source
 * @experimental The card's kinds and bucket keys may change until plugin
 *   attention items join them.
 */

import { authorizationGroups } from "../../auth/entity-read-access";
import { container } from "../../di/container";
import type { WorkflowFilter } from "../../domains/collections/query/workflow-filter";
import {
  callerMayReadReleases,
  overdueReleaseCount,
  stoppedReleaseCount,
} from "../../domains/releases/releases-widget-source";
import { singlesWithPendingChanges } from "../../domains/versions/versions-widget-source";
import {
  type DigestReader,
  runDigest,
} from "../../domains/widgets/attention/digest";
import { pluginItemReaders } from "../../domains/widgets/attention/items";
import {
  ATTENTION_DUE_WINDOW_MS,
  attentionPartKey,
  type AttentionContentKind,
  type AttentionKind,
} from "../../domains/widgets/attention-keys";
import {
  MAX_WIDGET_LIMIT,
  type WidgetQuery,
} from "../../domains/widgets/query";
import {
  queryableSlugs,
  readableCollectionSlugs,
} from "../../domains/widgets/reader-content";
import type { ResolverOptions } from "../../domains/widgets/resolved-sources";
import type {
  WidgetResult,
  WidgetResultField,
} from "../../domains/widgets/result";
import {
  failUnavailableSourceOrOp,
  getSource,
  refuseUnconsumedQueryFields,
} from "../../domains/widgets/sources";
import { ATTENTION_SOURCE_ID } from "../../domains/widgets/system-source-ids";
import { registerSystemSource } from "../../domains/widgets/system-sources";
import { errorFromServiceEnvelope } from "../../errors/from-service-envelope";
import { NextlyError } from "../../errors/nextly-error";
import type { CollectionsHandler } from "../collections-handler";

import type { ReadCaller } from "./readable-resources";

/**
 * How far one collection's count reads: past it, the card shows "99+".
 *
 * A card that asks for action gains nothing from "1,234" over "99+", because
 * its link opens the whole list; reading 100 ids is what stops a large table
 * from costing a full count on every dashboard load. "99+" is the common
 * convention for count badges.
 */
export const ATTENTION_COUNT_CAP = 99;

/**
 * How many collections one kind counts. Past it, the kind's total is a floor.
 *
 * Its own number, not shared with any other bound, because it limits a
 * different thing and the two must be free to move apart. Twenty follows the
 * translation worklist's per-collection count fan-out.
 */
export const ATTENTION_MAX_COLLECTIONS = 20;

/** One collection's or Single's share of a kind. */
interface AttentionPart {
  contentKind: AttentionContentKind;
  slug: string;
  /** For a Single, the language its pending change was counted in. */
  locale?: string;
  count: number;
  atLeast: boolean;
}

/** One kind's answer: its parts, or its count alone when it has none. */
interface AttentionAnswer {
  kind: AttentionKind;
  parts: AttentionPart[];
  /** For a kind with no parts. */
  count?: number;
  /** The kind's total is a floor even when every part is whole. */
  atLeast: boolean;
}

/**
 * Reads one kind for one caller, or `null` when the kind is absent for them.
 *
 * The seam further kinds join through: each is a function of the caller, run
 * under the same budget and signal, so a kind added later (plugin attention
 * items) reaches the card through this source rather than a second card path.
 */
type AttentionKindReader = (
  caller: ReadCaller,
  context: AttentionContext
) => Promise<AttentionAnswer | null>;

/** What every kind reader of one query shares. */
interface AttentionContext {
  /** One instant for the whole answer, so no two kinds disagree about "now". */
  now: Date;
  opts?: ResolverOptions;
  /** Whether this caller may read releases, asked once. */
  mayReadReleases: () => Promise<boolean>;
}

function collections(): CollectionsHandler {
  if (!container.has("collectionsHandler")) {
    throw NextlyError.internal({
      logContext: { reason: "collections-handler-unregistered" },
    });
  }
  return container.get<CollectionsHandler>("collectionsHandler");
}

/**
 * The collections a kind counts: the reader's queryable ones, in slug order so
 * the same twenty are counted on every read, and whether more were left out.
 */
async function countedCollections(
  caller: ReadCaller
): Promise<{ slugs: string[]; more: boolean }> {
  const queryable = queryableSlugs(
    "collection",
    await readableCollectionSlugs(caller)
  ).sort();
  return {
    slugs: queryable.slice(0, ATTENTION_MAX_COLLECTIONS),
    more: queryable.length > ATTENTION_MAX_COLLECTIONS,
  };
}

/**
 * Each counted collection's entries under `filter`, up to the cap, as the
 * caller reads them: through the entry list's own door, a few at a time, and
 * stopping when the slot's signal says nobody is waiting any more.
 */
async function collectionParts(
  caller: ReadCaller,
  filter: WorkflowFilter,
  context: AttentionContext
): Promise<{ parts: AttentionPart[]; more: boolean; any: boolean }> {
  const { slugs, more } = await countedCollections(caller);
  const parts: AttentionPart[] = [];
  for (const group of authorizationGroups(slugs)) {
    context.opts?.signal?.throwIfAborted();
    const counted = await Promise.all(
      group.map(async slug => {
        const result = await collections().countEntriesUpTo({
          collectionName: slug,
          overrideAccess: false,
          user: caller.user,
          ...(caller.authenticatedScope
            ? { authenticatedScope: caller.authenticatedScope }
            : {}),
          // Every lifecycle state, as the entry list asks by default: the
          // entries a workflow condition keeps may be drafts.
          status: "all",
          workflowFilter: filter,
          releaseNow: context.now,
          cap: ATTENTION_COUNT_CAP,
        });
        if (!result.success || !result.data) {
          // A collection the reader may read that could not be counted: the
          // card fails rather than shows a total missing a part.
          throw errorFromServiceEnvelope(result, {
            source: ATTENTION_SOURCE_ID,
            collectionName: slug,
          });
        }
        return {
          contentKind: "collection" as const,
          slug,
          count: result.data.count,
          atLeast: result.data.atLeast,
        };
      })
    );
    parts.push(...counted);
  }
  return { parts, more, any: slugs.length > 0 };
}

const readUnpublished: AttentionKindReader = async (caller, context) => {
  const [inCollections, singles] = await Promise.all([
    collectionParts(caller, { pendingChange: true, inRelease: null }, context),
    singlesWithPendingChanges(caller, context.opts),
  ]);
  // Absent, not empty, for a reader who may read no collection and no Single:
  // there is nothing this kind could ever show them.
  if (!inCollections.any && !singles.anyReadable) return null;
  return {
    kind: "unpublished",
    parts: [
      ...inCollections.parts,
      ...singles.singles.map(({ slug, locale }) => ({
        contentKind: "single" as const,
        slug,
        ...(locale !== null ? { locale } : {}),
        count: 1,
        // The walk's floor belongs to the kind, not to any one Single.
        atLeast: false,
      })),
    ],
    atLeast: inCollections.more || singles.atLeast,
  };
};

const readScheduled: AttentionKindReader = async (caller, context) => {
  if (!(await context.mayReadReleases())) return null;
  const { parts, more } = await collectionParts(
    caller,
    {
      pendingChange: false,
      inRelease: {
        scheduledBefore: new Date(
          context.now.getTime() + ATTENTION_DUE_WINDOW_MS
        ),
      },
    },
    context
  );
  return { kind: "scheduled", parts, atLeast: more };
};

const readOverdue: AttentionKindReader = async (caller, context) => {
  if (!(await context.mayReadReleases())) return null;
  return {
    kind: "overdue",
    parts: [],
    count: await overdueReleaseCount(caller),
    atLeast: false,
  };
};

/** The kinds core reads, in the order `ATTENTION_KINDS` lists them. */
const CORE_KIND_READERS: readonly AttentionKindReader[] = [
  readUnpublished,
  readScheduled,
  readOverdue,
];

/** What the card shows for a part: its collection's or Single's own label. */
function partLabel(part: AttentionPart): string {
  return getSource(`${part.contentKind}:${part.slug}`)?.label ?? part.slug;
}

/** One bucket of the answer: a kind's total or one part's count. */
interface AttentionBucket {
  value: string;
  count: number;
  atLeast?: boolean;
}

/**
 * One kind's buckets: its total, then a bucket per part with something in it,
 * each part with the label its link is shown under. None for an empty kind.
 */
function answerBuckets(answer: AttentionAnswer): {
  buckets: AttentionBucket[];
  choices: { value: string; label: string }[];
} {
  const parts = answer.parts.filter(part => part.count > 0);
  const total =
    answer.count ?? parts.reduce((sum, part) => sum + part.count, 0);
  const atLeast = answer.atLeast || parts.some(part => part.atLeast);
  // Nothing found, and nothing left unread: the kind is absent, as if empty.
  // Nothing found while some lists went unread is NOT empty: the kind stays,
  // a zero floor, so the card never says "All clear" over lists it skipped.
  if (total === 0 && !atLeast) return { buckets: [], choices: [] };
  const buckets: AttentionBucket[] = [
    { value: answer.kind, count: total, ...(atLeast ? { atLeast: true } : {}) },
  ];
  const choices: { value: string; label: string }[] = [];
  for (const part of parts) {
    const value = attentionPartKey(
      answer.kind,
      part.contentKind,
      part.slug,
      part.locale
    );
    buckets.push({
      value,
      count: part.count,
      ...(part.atLeast ? { atLeast: true } : {}),
    });
    choices.push({ value, label: partLabel(part) });
  }
  return { buckets, choices };
}

/**
 * The answers as a grouped result: a bucket per kind with something waiting,
 * then a bucket per part with something waiting, largest first as every
 * grouped result is. Empty kinds and parts are left out, so absence and zero
 * read the same.
 */
function asGroupedResult(
  answers: readonly AttentionAnswer[],
  limit: number,
  asOf: Date
): WidgetResult {
  const kinds: AttentionBucket[] = [];
  const parts: AttentionBucket[] = [];
  const labels = new Map<string, string>();
  for (const answer of answers) {
    const [kind, ...own] = answerBuckets(answer).buckets;
    if (kind !== undefined) kinds.push(kind);
    parts.push(...own);
  }
  for (const answer of answers) {
    for (const choice of answerBuckets(answer).choices) {
      labels.set(choice.value, choice.label);
    }
  }
  // The query's bucket limit bounds the answer as it bounds every grouped one.
  // Kinds first, since each is the total its parts break down, then the parts
  // with most waiting; what the limit leaves out is said with `truncated`.
  // Stable, so equal counts keep the order they were built in.
  const ranked = [...kinds, ...parts.sort((a, b) => b.count - a.count)];
  const kept = ranked.slice(0, Math.max(0, limit));
  const buckets = [...kept].sort((a, b) => b.count - a.count);
  const choices = kept.flatMap(bucket => {
    const label = labels.get(bucket.value);
    return label === undefined ? [] : [{ value: bucket.value, label }];
  });
  const field: WidgetResultField = {
    name: "item",
    label: "Item",
    type: "string",
    ...(choices.length > 0 ? { choices } : {}),
  };
  // No result-level `atLeast`: it says EVERY bucket is a floor, and here a
  // floor belongs to the kinds and parts that reached a bound, each saying so
  // on its own bucket.
  return {
    op: "groupBy",
    buckets,
    ...(kept.length < ranked.length ? { truncated: true } : {}),
    // The one instant every kind was read at, so a card links the week the
    // scheduled count was measured over rather than one from its own clock.
    asOf: asOf.toISOString(),
    field,
  };
}

/**
 * What this source does with each field of a widget query: it answers one
 * fixed question, grouped by item or as the digest, so nothing else a query
 * may carry applies.
 */
const QUERY_FIELD_USE: Record<keyof WidgetQuery, "consumed" | "refused"> = {
  source: "consumed",
  op: "consumed",
  groupBy: "consumed",
  // Defaulted and bounded by validation; it bounds how many kinds and parts
  // the grouped answer carries, and how many items the digest does.
  limit: "consumed",
  select: "refused",
  where: "refused",
  sort: "refused",
  status: "refused",
  dateField: "refused",
  interval: "refused",
  since: "refused",
  until: "refused",
  range: "refused",
};

/**
 * Core's release kinds of the digest: what the releases domain counts on its
 * Needs attention tab, each critical and linked to that tab filtered to it.
 */
const RELEASE_KINDS = [
  {
    id: "core/stopped-releases",
    kind: "stopped",
    label: "Releases that stopped",
    count: stoppedReleaseCount,
  },
  {
    id: "core/overdue-releases",
    kind: "overdue",
    label: "Overdue releases",
    count: overdueReleaseCount,
  },
] as const;

/**
 * A reader for each release kind. A reader who may not read releases gets
 * `null` from each, so neither leaves an item, exactly as on a site with none.
 */
function releaseReaders(caller: ReadCaller): DigestReader[] {
  let mayRead: Promise<boolean> | undefined;
  const mayReadReleases = () => (mayRead ??= callerMayReadReleases(caller));
  return RELEASE_KINDS.map(({ id, kind, label, count }) => ({
    id,
    kind,
    label,
    severity: "critical" as const,
    link: `releases?tab=attention&reason=${kind}`,
    owner: "core",
    read: async () => ((await mayReadReleases()) ? count(caller) : null),
  }));
}

/**
 * The digest as a list result: the items the query's `limit` holds, most
 * urgent first, and how many there are in all.
 */
async function resolveDigest(
  query: WidgetQuery,
  caller: ReadCaller,
  opts?: ResolverOptions
): Promise<WidgetResult> {
  // One instant for every item, so each plugin item counts against the same "now".
  const now = opts?.now ?? new Date();
  const readers = [
    ...releaseReaders(caller),
    ...(await pluginItemReaders(caller, now)),
  ];
  const items = await runDigest(readers, opts?.signal);
  return {
    op: "list",
    items: items
      .slice(0, query.limit ?? MAX_WIDGET_LIMIT)
      .map(item => ({ ...item })),
    total: items.length,
  };
}

async function resolveAttention(
  query: WidgetQuery,
  caller: ReadCaller,
  opts?: ResolverOptions
): Promise<WidgetResult> {
  refuseUnconsumedQueryFields(query, QUERY_FIELD_USE, ATTENTION_SOURCE_ID);
  if (query.op === "list") return resolveDigest(query, caller, opts);
  let mayRead: Promise<boolean> | undefined;
  const context: AttentionContext = {
    now: new Date(),
    ...(opts ? { opts } : {}),
    mayReadReleases: () => (mayRead ??= callerMayReadReleases(caller)),
  };
  const answers = (
    await Promise.all(CORE_KIND_READERS.map(read => read(caller, context)))
  ).filter((answer): answer is AttentionAnswer => answer !== null);
  if (answers.length === 0) {
    // A reader who may read none of what this card counts is told the card is
    // not available to them, as for any source they may not read. An empty
    // answer would draw "All clear", which is a claim about content they were
    // never shown.
    failUnavailableSourceOrOp(
      `source "${ATTENTION_SOURCE_ID}" has no kind this caller may read`
    );
  }
  return asGroupedResult(answers, query.limit ?? MAX_WIDGET_LIMIT, context.now);
}

/**
 * Publish the source and the function that answers it.
 *
 * `supports` names `groupBy`, a count per kind and per part for the card that
 * reads it today, and `list`, the digest: one item per thing waiting. No other
 * op has a meaning here.
 */
export function registerAttentionWidgetSource(): void {
  registerSystemSource(
    {
      id: ATTENTION_SOURCE_ID,
      label: "Needs attention",
      kind: "system",
      supports: ["groupBy", "list"],
      fields: [{ name: "item", type: "string", label: "Item" }],
    },
    resolveAttention
  );
}
