/**
 * What a Count card draws, read from its cells: the number, its published and
 * draft split, what scheduled releases will publish, and the last 30 days
 * against the 30 before.
 *
 * Kept apart from the component so the reading is tested without rendering:
 * which cell the number comes from, where each part links, and what the change
 * is.
 */

import { IN_RELEASE_KEY } from "nextly/reserved-filter-keys";
import type { WidgetSlot } from "nextly/widget-result";

import { buildRoute, ROUTES } from "@admin/constants/routes";

import { collectionLabel } from "../widgets/widget-as-asked";

/** One part of the split, and the list that holds exactly it. */
export interface CountPart {
  count: number;
  href: string;
}

/** One day of the trend. */
export interface CountTrendPoint {
  start: string;
  count: number;
}

/** What the card shows. */
export type CountView =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "error"; message: string }
  | {
      state: "ready";
      total: number;
      /** The collection's list, under the card's Filter. */
      href: string;
      /** Present for a collection with a draft and published lifecycle. */
      split?: { published: CountPart; draft: CountPart };
      /**
       * What scheduled releases will publish, linking to exactly that list.
       * Absent for a reader with no release to read, as on a site without
       * releases; zero where releases hold none of these entries.
       */
      scheduled?: CountPart;
      /** Present once the trend and the period before it have answered. */
      trend?: {
        points: CountTrendPoint[];
        recent: number;
        prior: number;
        change: number;
      };
    };

/** A collection's list, under the card's Filter and, for a part, a status. */
function listHref(
  collection: string,
  filter: Record<string, unknown> | undefined,
  status?: "published" | "draft"
): string {
  const params = new URLSearchParams();
  if (status !== undefined) params.set("status", status);
  if (filter !== undefined && Object.keys(filter).length > 0) {
    params.set("where", JSON.stringify(filter));
  }
  const query = params.toString();
  const path = buildRoute(ROUTES.COLLECTION_ENTRIES, { slug: collection });
  return query === "" ? path : `${path}?${query}`;
}

/**
 * The scheduled figure, when its cell answered with a count. A cell that is
 * not available, failed or has not answered leaves the figure out: it is one
 * part of the card, and never takes the number down with it.
 */
function scheduledOf(
  cells: Readonly<Record<string, WidgetSlot>>,
  collection: string,
  filter: Record<string, unknown> | undefined
): CountPart | undefined {
  const scheduled = cells.scheduled;
  if (scheduled === undefined || !scheduled.ok) return undefined;
  if (scheduled.result.op !== "count") return undefined;
  return {
    count: scheduled.result.total,
    // The card's Filter and the release condition, at the top level where the
    // list reads it: the list the figure counts.
    href: listHref(collection, { ...filter, [IN_RELEASE_KEY]: true }),
  };
}

/** A cell's slot as a failure the whole card reports, or `undefined`. */
function failureOf(slot: WidgetSlot): CountView | undefined {
  if (slot.ok) return undefined;
  return slot.code === "unavailable"
    ? { state: "unavailable" }
    : { state: "error", message: slot.error };
}

/**
 * The number, from whichever cell the card asked for it: the split's buckets
 * summed (the null bucket included, so a row with no status still counts), or
 * the plain count of a collection without a lifecycle.
 */
function totalOf(
  cells: Readonly<Record<string, WidgetSlot>>
):
  | { total: number; buckets?: { value: string | null; count: number }[] }
  | CountView
  | undefined {
  const split = cells.split;
  if (split !== undefined) {
    const failed = failureOf(split);
    if (failed) return failed;
    if (split.ok && split.result.op === "groupBy") {
      const buckets = split.result.buckets;
      return {
        total: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
        buckets,
      };
    }
  }
  const total = cells.total;
  if (total !== undefined) {
    const failed = failureOf(total);
    if (failed) return failed;
    if (total.ok && total.result.op === "count") {
      return { total: total.result.total };
    }
  }
  return undefined;
}

/** The trend, once both of its reads have answered; otherwise nothing yet. */
function trendOf(
  cells: Readonly<Record<string, WidgetSlot>>
): Extract<CountView, { state: "ready" }>["trend"] {
  const trend = cells.trend;
  const prior = cells.prior;
  if (
    trend === undefined ||
    prior === undefined ||
    !trend.ok ||
    !prior.ok ||
    trend.result.op !== "timeseries" ||
    prior.result.op !== "count"
  ) {
    return undefined;
  }
  const points = trend.result.points;
  const recent = points.reduce((sum, point) => sum + point.count, 0);
  return {
    points,
    recent,
    prior: prior.result.total,
    change: recent - prior.result.total,
  };
}

/**
 * The name of the collection a Count card is set to: its label as the server
 * published it to this reader, or its slug where none is known.
 */
export function collectionLabelOf(
  settings: { collection?: unknown },
  sources: readonly { collection: string; label: string }[] | undefined
): string | undefined {
  return typeof settings.collection === "string"
    ? collectionLabel(settings.collection, sources)
    : undefined;
}

/** The card's view of its cells, for the collection and Filter it is set to. */
export function countView(
  cells: Readonly<Record<string, WidgetSlot>> | undefined,
  settings: { collection?: unknown; filter?: unknown }
): CountView {
  const collection =
    typeof settings.collection === "string" ? settings.collection : undefined;
  if (collection === undefined) return { state: "unavailable" };
  const read = totalOf(cells ?? {});
  if (read === undefined) return { state: "loading" };
  if ("state" in read) return read;
  const filter =
    typeof settings.filter === "object" && settings.filter !== null
      ? (settings.filter as Record<string, unknown>)
      : undefined;
  const countOf = (status: string) =>
    read.buckets?.find(bucket => bucket.value === status)?.count ?? 0;
  const trend = trendOf(cells ?? {});
  const scheduled = scheduledOf(cells ?? {}, collection, filter);
  return {
    state: "ready",
    total: read.total,
    href: listHref(collection, filter),
    ...(read.buckets === undefined
      ? {}
      : {
          split: {
            published: {
              count: countOf("published"),
              href: listHref(collection, filter, "published"),
            },
            draft: {
              count: countOf("draft"),
              href: listHref(collection, filter, "draft"),
            },
          },
        }),
    ...(scheduled === undefined ? {} : { scheduled }),
    ...(trend === undefined ? {} : { trend }),
  };
}
