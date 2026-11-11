/**
 * Core's Count card, declared with `defineWidget`. One module per widget;
 * `core-widgets/index.ts` lists them in their order.
 *
 * A number, and one line under it, both about the same set: the entries of a
 * collection the card's Count setting counts (every entry, the published ones
 * or the drafts) under its Filter, or the people with an account, for a reader
 * who may read users. The line is the card's "Under the number": the change
 * this week, the trend over the last 8 weeks, the split by status, or nothing.
 *
 * Its `load` reads, as the person asking, only what the card draws:
 *
 * - the number: ONE read, the status split where the card draws it (the total
 *   is its buckets' sum, the null bucket included), a plain count otherwise;
 * - the change: how many of the same set were made in the last 7 days;
 * - the trend: the same set made in each week of the last 90 days, from which
 *   the number at the end of each of the last 8 weeks is taken;
 * - the split: the published and draft entries, and the entries a scheduled
 *   release will publish, through the entry list's own condition, so the
 *   figure and the list it links to are one read.
 *
 * A collection through the public read services alone; the people through
 * `system:users`, which answers only a reader who may read users. A line that
 * cannot be read leaves the card without it, never taking the number with it.
 *
 * @module domains/widgets/core-widgets/count
 */

import { IN_RELEASE_KEY } from "../../collections/query/reserved-filter-keys";
import {
  defineWidget,
  type WidgetCollectionDescription,
  type WidgetReadServices,
} from "../declaration/define-widget";
import {
  setting,
  type SettingDeclaration,
  type WidgetFilter,
} from "../declaration/setting-builders";
import { USERS_SOURCE_ID } from "../system-source-ids";
import { COUNT_USERS_SOURCE } from "../users-gate";

import { askedQuery } from "./asked";
import type { CountLine, CountMeasure, CountWidgetData } from "./data";
import { CORE_WIDGET_ID } from "./ids";
import { CARD_FILTER } from "./shared";
import { readCoreCount, readCoreSeries } from "./system-read";

/**
 * The card's Source: a collection, or Users (`users`) for a reader who may read
 * users. Written as a type, as `TITLED_COLLECTION` is, so the published
 * declaration names it by the builders' own `SettingDeclaration`.
 */
const COUNT_SOURCE: SettingDeclaration<string, "collection"> & {
  readonly users: true;
} = {
  ...setting.collection({
    label: "Source",
    admin: {
      description: "A collection, or Users for people who may see users.",
    },
  }),
  users: true,
};

/** The card's "Count": which of a collection's entries the number counts. */
const COUNT_MEASURE = setting.select({
  label: "Count",
  options: [
    { label: "All entries", value: "all" },
    { label: "Published", value: "published" },
    { label: "Drafts", value: "draft" },
  ],
  defaultValue: "all",
  section: "data",
});

/** The card's "Under the number": the one line it draws beneath the number. */
const COUNT_LINE = setting.select({
  label: "Under the number",
  options: [
    { label: "Change this week", value: "change" },
    { label: "Trend line", value: "trend" },
    { label: "Status split", value: "split" },
    { label: "Nothing", value: "none" },
  ],
  defaultValue: "change",
  section: "display",
});

/** Count's settings, in the order its settings drawer shows them. */
const COUNT_SETTINGS = {
  collection: COUNT_SOURCE,
  count: COUNT_MEASURE,
  filter: CARD_FILTER,
  show: COUNT_LINE,
};

/** The weeks a trend line draws, before the number now. */
const TREND_WEEKS = 8;

/**
 * A part of the card beside its number, or nothing when its read fails: the
 * change, the trend and the scheduled figure each leave the card when they
 * cannot be read (a reader with no release to read is refused the scheduled
 * one), and never take the number down with them.
 */
async function optionalPart<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

/**
 * The number at the end of each of the last `TREND_WEEKS` weeks, oldest first,
 * then `total` itself: walked back from now, each week taking off what was
 * made in the weeks after it. `points` are weekly, oldest first, the last one
 * the week now running.
 */
export function trendFrom(
  points: readonly { count: number }[],
  total: number
): number[] {
  const values = [total];
  let after = 0;
  for (
    let index = points.length - 1;
    index > 0 && values.length <= TREND_WEEKS;
    index -= 1
  ) {
    after += points[index]?.count ?? 0;
    values.unshift(Math.max(0, total - after));
  }
  return values;
}

/** How many a series holds in all. */
function sumOf(points: readonly { count: number }[]): number {
  return points.reduce((sum, point) => sum + point.count, 0);
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

/**
 * The line a card draws, as its settings ask it: a status split only where it
 * splits the set the number counts (`splittable`: every entry of a collection
 * with a lifecycle); the change this week in its place elsewhere.
 */
function lineFor(asked: CountLine, splittable: boolean): CountLine {
  return asked === "split" && !splittable ? "change" : asked;
}

/** The people with an account, and the line under them, from `system:users`. */
async function countPeople(
  line: CountLine,
  input: { services: WidgetReadServices; signal: AbortSignal; now: Date }
): Promise<CountWidgetData> {
  const drawn = lineFor(line, false);
  const total = await readCoreCount(
    { source: USERS_SOURCE_ID, op: "count" },
    input
  );
  const change =
    drawn === "change"
      ? await optionalPart(async () =>
          sumOf(
            await readCoreSeries(
              { source: USERS_SOURCE_ID, op: "timeseries", range: "7d" },
              input
            )
          )
        )
      : undefined;
  const trend =
    drawn === "trend"
      ? await optionalPart(async () =>
          trendFrom(
            await readCoreSeries(
              { source: USERS_SOURCE_ID, op: "timeseries", range: "90d" },
              input
            ),
            total
          )
        )
      : undefined;
  return {
    total,
    counted: "people",
    line: drawn,
    ...(change === undefined ? {} : { change }),
    ...(trend === undefined ? {} : { trend }),
  };
}

/**
 * A collection with a status, as its read services ask it: what the card's
 * Count counts, as a `status` and a `where`. The published entries are what a
 * read naming no status reads; the drafts, every entry whose status is draft.
 */
function measured(
  counted: CountMeasure,
  settings: Readonly<Record<string, unknown>> & { collection: string },
  described: WidgetCollectionDescription | undefined
): { status?: "all"; where?: WidgetFilter } {
  const where = whereFor(
    counted === "draft" ? { status: { equals: "draft" } } : undefined,
    settings,
    described
  );
  return {
    ...(counted === "published" ? {} : { status: "all" as const }),
    ...(where === undefined ? {} : { where }),
  };
}

/**
 * A sample collection, for the add panel's row and the preview cases: plainly
 * made up, never read from anything.
 */
const SAMPLE_COUNT: CountWidgetData = {
  total: 128,
  counted: "all",
  line: "change",
  change: 3,
};

export const countWidget = defineWidget({
  id: CORE_WIDGET_ID.count,
  title: "Count",
  description: "How many entries a collection holds, and what changed.",
  // Added from a collection's group of the add panel, once per collection,
  // and never placed on the default dashboard.
  offered: "per-collection",
  // A figure, a quarter wide by default, up to two thirds.
  size: { default: { w: 3, h: 2 }, max: { w: 8, h: 3 } },
  settings: COUNT_SETTINGS,
  load: async ({
    settings,
    services,
    signal,
    now,
  }): Promise<CountWidgetData> => {
    const { collection } = settings;
    if (collection === COUNT_USERS_SOURCE) {
      return countPeople(settings.show, { services, signal, now });
    }
    const described = await services.describe(collection);
    const hasStatus = described?.status === true;
    // A collection with no lifecycle has only every entry to count.
    const counted: CountMeasure = hasStatus ? settings.count : "all";
    const drawn = lineFor(settings.show, hasStatus && counted === "all");
    const read = measured(counted, settings, described);

    // One read for the number either way: the split, where it is drawn, sums
    // to it.
    const number: Promise<{
      total: number;
      split?: { published: number; draft: number };
    }> =
      drawn === "split"
        ? services
            .groupBy(collection, { field: "status", ...read })
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
        : services.count(collection, read).then(total => ({ total }));

    // What scheduled releases will publish, beside the split alone.
    const scheduled =
      drawn === "split"
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

    // The same set, made in the last 7 days.
    const change =
      drawn === "change"
        ? optionalPart(() =>
            services.count(collection, { ...read, window: { range: "7d" } })
          )
        : Promise.resolve(undefined);

    // The same set, made in each week of the last 90 days.
    const weeks =
      drawn === "trend"
        ? optionalPart(() =>
            services.timeseries(collection, { range: "90d", ...read })
          )
        : Promise.resolve(undefined);

    const [figure, inRelease, made, series] = await Promise.all([
      number,
      scheduled,
      change,
      weeks,
    ]);
    return {
      total: figure.total,
      counted,
      line: drawn,
      ...(made === undefined ? {} : { change: made }),
      ...(series === undefined
        ? {}
        : { trend: trendFrom(series.points, figure.total) }),
      ...(figure.split === undefined
        ? {}
        : {
            split: {
              ...figure.split,
              ...(inRelease === undefined ? {} : { scheduled: inRelease }),
            },
          }),
    };
  },
  view: { component: "core#Count" },
  // It loads, and its add-panel row is sketched, as a number.
  skeleton: "figure",
  // A count of nothing is the number 0, drawn as every other number is.
  isEmpty: () => false,
  preview: [{ name: "Sample collection", data: SAMPLE_COUNT }],
});
