/**
 * What a Count card draws, read from the data its `load` answers: what the
 * number counts and where it links, then the one line under it (the change
 * this week, the trend, the split by status, or nothing), each part of the
 * split linking to the list that holds exactly it under the card's Filter.
 *
 * Kept apart from the component so the reading is tested without rendering:
 * what each line says, and where each part links.
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

/** The line under the number, as the card draws it. */
export type CountLineView =
  | { kind: "none" }
  /** How many of what the number counts were made in the last 7 days. */
  | { kind: "change"; change: number }
  /** The number at the end of each of the last 8 weeks, then now. */
  | { kind: "trend"; values: readonly number[] }
  | {
      kind: "split";
      published: CountPart;
      draft: CountPart;
      /** Absent for a reader with no release to read. */
      scheduled?: CountPart;
    };

/**
 * What the card shows: the frame draws loading, no permission and error before
 * the card is handed its data, so a card is only ever ready, or set to no
 * collection.
 */
export type CountView =
  | { state: "unavailable" }
  | {
      state: "ready";
      /** What the number counts, as the card's label says it: "Entries", "Drafts", "People". */
      label: string;
      total: number;
      /** The list the number counts: the collection's under the card's Filter, or the people. */
      href: string;
      line: CountLineView;
    };

/** What the label calls each set a number can count. */
const COUNTED_LABEL: Readonly<Record<CountWidgetData["counted"], string>> = {
  all: "Entries",
  published: "Published",
  draft: "Drafts",
  people: "People",
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
 * The name of what a Count card is set to: Users for the people; a
 * collection's label as the server published it to this reader, or its slug
 * where none is known.
 */
export function collectionLabelOf(
  settings: { collection?: unknown },
  sources: readonly { collection: string; label: string }[] | undefined
): string | undefined {
  return typeof settings.collection === "string"
    ? collectionLabel(settings.collection, sources)
    : undefined;
}

/** The line the data answered, as the card draws it. */
function lineOf(
  data: CountWidgetData,
  collection: string,
  filter: Record<string, unknown> | undefined
): CountLineView {
  if (data.line === "change" && data.change !== undefined) {
    return { kind: "change", change: data.change };
  }
  if (data.line === "trend" && data.trend !== undefined) {
    return { kind: "trend", values: data.trend };
  }
  if (data.line === "split" && data.split !== undefined) {
    const { published, draft, scheduled } = data.split;
    return {
      kind: "split",
      published: {
        count: published,
        href: listHref(collection, filter, "published"),
      },
      draft: { count: draft, href: listHref(collection, filter, "draft") },
      // What scheduled releases will publish: the card's Filter and the
      // release condition, at the top level where the list reads it. Absent
      // where the load left it out, never drawn as zero.
      ...(scheduled === undefined
        ? {}
        : {
            scheduled: {
              count: scheduled,
              href: listHref(collection, {
                ...filter,
                [IN_RELEASE_KEY]: true,
              }),
            },
          }),
    };
  }
  return { kind: "none" };
}

/** The card's view of its data, for the source and Filter it is set to. */
export function countView(
  data: CountWidgetData,
  settings: { collection?: unknown; filter?: unknown }
): CountView {
  const collection =
    typeof settings.collection === "string" ? settings.collection : undefined;
  if (collection === undefined) return { state: "unavailable" };
  const label = COUNTED_LABEL[data.counted];
  if (data.counted === "people") {
    return {
      state: "ready",
      label,
      total: data.total,
      href: ROUTES.USERS,
      line: lineOf(data, collection, undefined),
    };
  }
  const filter =
    typeof settings.filter === "object" && settings.filter !== null
      ? (settings.filter as Record<string, unknown>)
      : undefined;
  return {
    state: "ready",
    label,
    total: data.total,
    href: listHref(
      collection,
      filter,
      data.counted === "all" ? undefined : data.counted
    ),
    line: lineOf(data, collection, filter),
  };
}

/**
 * What the change line says: "+3 this week", or "No change this week" when
 * nothing was made. `format` writes the number in the admin's locale.
 */
export function changeSentence(
  change: number,
  format: (value: number) => string
): string {
  return change > 0 ? `+${format(change)} this week` : "No change this week";
}
