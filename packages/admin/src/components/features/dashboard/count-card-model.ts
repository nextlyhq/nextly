/**
 * What a Count card draws, read from the data its `load` answers: the number,
 * its published and draft split, what scheduled releases will publish, and the
 * last 30 days against the 30 before, each part linking to the list that holds
 * exactly it under the card's Filter.
 *
 * Kept apart from the component so the reading is tested without rendering:
 * where each part links, and what the change is.
 */

import type { CountWidgetData } from "nextly/core-widget-data";
import { IN_RELEASE_KEY } from "nextly/reserved-filter-keys";

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

/**
 * What the card shows: the frame draws loading, no permission and error before
 * the card is handed its data, so a card is only ever ready, or set to no
 * collection.
 */
export type CountView =
  | { state: "unavailable" }
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
      /** Present where the card was loaded large, and the trend and the period before it read. */
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

/** The card's view of its data, for the collection and Filter it is set to. */
export function countView(
  data: CountWidgetData,
  settings: { collection?: unknown; filter?: unknown }
): CountView {
  const collection =
    typeof settings.collection === "string" ? settings.collection : undefined;
  if (collection === undefined) return { state: "unavailable" };
  const filter =
    typeof settings.filter === "object" && settings.filter !== null
      ? (settings.filter as Record<string, unknown>)
      : undefined;
  const { split, scheduled, trend } = data;
  const recent = trend?.points.reduce((sum, point) => sum + point.count, 0);
  return {
    state: "ready",
    total: data.total,
    href: listHref(collection, filter),
    ...(split === undefined
      ? {}
      : {
          split: {
            published: {
              count: split.published,
              href: listHref(collection, filter, "published"),
            },
            draft: {
              count: split.draft,
              href: listHref(collection, filter, "draft"),
            },
          },
        }),
    // What scheduled releases will publish: the card's Filter and the release
    // condition, at the top level where the list reads it, the list the figure
    // counts. Absent where the load left it out, never drawn as zero.
    ...(scheduled === undefined
      ? {}
      : {
          scheduled: {
            count: scheduled,
            href: listHref(collection, { ...filter, [IN_RELEASE_KEY]: true }),
          },
        }),
    ...(trend === undefined || recent === undefined
      ? {}
      : {
          trend: {
            points: [...trend.points],
            recent,
            prior: trend.prior,
            change: recent - trend.prior,
          },
        }),
  };
}
