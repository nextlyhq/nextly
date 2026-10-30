/**
 * Core's Count card, declared with `defineWidget`. One module per widget;
 * `core-widgets/index.ts` lists them in their order.
 *
 * Its `load` reads, as the person asking and through the public read services
 * alone, only what the card's size draws:
 *
 * - every size: the number. ONE read either way: the status split for a
 *   collection with a draft and published status (the total is its buckets'
 *   sum, the null bucket included), a plain count for one without;
 * - from the medium tier, for a collection with a status: the entries a
 *   scheduled release will publish, through the entry list's own condition, so
 *   the figure and the list it links to are one read;
 * - the large tier alone: the last 30 days, as a series over that range, and a
 *   count of the 30 days before them, the window as long that ends where the
 *   series starts, so an entry is in one of the two at most.
 *
 * Its admin component draws the answer by the card's own width, so a card
 * crossing a tier is loaded again and asks the reads that tier draws.
 *
 * @module domains/widgets/core-widgets/count
 */

import { IN_RELEASE_KEY } from "../../collections/query/reserved-filter-keys";
import {
  defineWidget,
  type WidgetCollectionDescription,
} from "../declaration/define-widget";
import type { WidgetFilter } from "../declaration/setting-builders";

import { askedQuery } from "./asked";
import type { CountWidgetData } from "./data";
import { CORE_WIDGET_ID } from "./ids";
import { CARD_COLLECTION, CARD_FILTER } from "./shared";

/** Count's settings: the collection it counts, and the Filter it counts under. */
const COUNT_SETTINGS = {
  collection: CARD_COLLECTION,
  filter: CARD_FILTER,
};

/**
 * A part of the card beside its number, or nothing when its read fails: the
 * scheduled figure and the trend each leave the card when they cannot be read
 * (a reader with no release to read is refused the scheduled one), and never
 * take the number down with them.
 */
async function optionalPart<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

/**
 * The card's `where` for one of its reads: `declared` narrowed by the card's
 * Filter, as core's knobs join them (`askedQuery`).
 */
function whereFor(
  declared: Record<string, unknown> | undefined,
  settings: Readonly<Record<string, unknown>> & { collection: string },
  described: WidgetCollectionDescription | undefined
): WidgetFilter | undefined {
  return askedQuery(
    { op: "count", ...(declared === undefined ? {} : { where: declared }) },
    COUNT_SETTINGS,
    settings,
    described
  ).where;
}

export const countWidget = defineWidget({
  id: CORE_WIDGET_ID.count,
  title: "Count",
  description:
    "How many entries a collection holds, published and draft, and how that is changing.",
  // Added from a collection's group of the add panel, once per collection,
  // and never placed on the default dashboard.
  offered: "per-collection",
  // A figure, a quarter wide by default; up to two thirds, where the trend
  // is drawn, and a row taller to give it room.
  size: { default: { w: 3, h: 2 }, max: { w: 8, h: 3 } },
  settings: COUNT_SETTINGS,
  load: async ({ settings, services, size }): Promise<CountWidgetData> => {
    const { collection } = settings;
    const described = await services.describe(collection);
    const hasStatus = described?.status === true;
    const where = whereFor(undefined, settings, described);
    const counted = { ...(where === undefined ? {} : { where }) };

    // One shape from either read, so the split is known where it is read.
    const number: Promise<Pick<CountWidgetData, "total" | "split">> = hasStatus
      ? services
          .groupBy(collection, { field: "status", status: "all", ...counted })
          .then(({ buckets }) => ({
            total: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
            split: {
              published:
                buckets.find(bucket => bucket.value === "published")?.count ??
                0,
              draft:
                buckets.find(bucket => bucket.value === "draft")?.count ?? 0,
            },
          }))
      : services
          .count(collection, { status: "all", ...counted })
          .then(total => ({ total }));

    // Beside the split, which a small card leaves out.
    const scheduled =
      hasStatus && size.tier !== "small"
        ? optionalPart(() => {
            const held = whereFor(
              { [IN_RELEASE_KEY]: true },
              settings,
              described
            );
            return services.count(collection, {
              status: "all",
              ...(held === undefined ? {} : { where: held }),
            });
          })
        : Promise.resolve(undefined);

    // Drawn by a large card alone, so a narrower one does not ask it: the
    // last 30 days as a series over that range, and the 30 days before them as
    // a count over the window as long that ends where the series starts.
    const trend =
      size.tier === "large"
        ? optionalPart(async () => {
            const [series, prior] = await Promise.all([
              services.timeseries(collection, {
                range: "30d",
                dateField: "createdAt",
                status: "all",
                ...counted,
              }),
              services.count(collection, {
                status: "all",
                window: { range: "30d", previous: true },
                ...counted,
              }),
            ]);
            return { points: series.points, prior };
          })
        : Promise.resolve(undefined);

    const [figure, inRelease, recent] = await Promise.all([
      number,
      scheduled,
      trend,
    ]);
    return {
      total: figure.total,
      // Read for the number whatever the size, so it is answered at every
      // size; the card draws it from the medium tier.
      ...(figure.split === undefined ? {} : { split: figure.split }),
      ...(inRelease === undefined ? {} : { scheduled: inRelease }),
      ...(recent === undefined ? {} : { trend: recent }),
    };
  },
  view: { component: "core#Count" },
  // It loads, and its add-panel row is sketched, as a number.
  skeleton: "figure",
  // A count of nothing is the number 0, drawn as every other number is.
  isEmpty: () => false,
});
