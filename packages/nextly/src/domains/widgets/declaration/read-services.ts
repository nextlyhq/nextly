/**
 * The reads a declared widget's data function may make, bound to the person
 * asking for the card.
 *
 * 🔴 Person-bound by construction, not by convention. The services take no
 * person, user or access option: who reads is bound here, before the function
 * is handed them, so a function cannot leave the person out and read as the
 * system, and an option a plain JavaScript caller passes anyway (`as`, `user`,
 * `overrideAccess`) is never read. A plugin's `ctx.services`, which read as the
 * system when no person is passed, are never what a data function gets.
 *
 * Every read is a widget query core checks and runs exactly as it checks and
 * runs a card's own: the person may read its source, the query is valid for
 * it, and it runs with the person's read rules. One path, so a data function
 * can read nothing the person could not ask the dashboard for directly.
 *
 * @module domains/widgets/declaration/read-services
 */
import { humanizeFieldName } from "../../../collections/fields/field-label";
import { NextlyError } from "../../../errors/nextly-error";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { intervalWindow } from "../../collections/query/timeseries-interval";
import { answerAsAsked } from "../answer-as-asked";
import { executeWidgetQuery } from "../execute";
import { publishableContentSources } from "../publish";
import {
  isRangeInterval,
  isTimeseriesRange,
  openWindowEnd,
  rangeWindow,
  type TimeseriesRange,
  type WidgetQuery,
} from "../query";
import type { WidgetResult } from "../result";
import { naturalGroupBy } from "../settings";

import { renamedCollection } from "./card-settings";
import type { WidgetReadServices } from "./define-widget";
import { sentAsJson, sentRows } from "./transportable";

/** What the services are bound to, for one card. */
export interface ReadServiceBinding {
  /** The person asking for the card, as the batch resolved them. */
  caller: ReadCaller;
  /**
   * Checks a query as a card's own is checked, before it runs: the caller may
   * read its source, and the query is valid for that source. Answers the
   * query to run, or throws the refusal the card would get. A function, not a
   * method: it is handed over on its own, with no object to be called on.
   */
  prepare: (query: unknown) => Promise<WidgetQuery>;
  /** Aborted at the card's budget, or when the batch is given up. */
  signal: AbortSignal;
  /** The batch's instant, which every read measures its spans from. */
  now: Date;
  /** The owner's collections the site renamed: declared slug to the site's. */
  collections?: Readonly<Record<string, string>>;
  /**
   * 🔴 A collection, by the site's slug, that this binding answers "nothing
   * there" for. A read of it is checked exactly as any other, so a malformed
   * one is refused for every reader alike, and is then answered as an empty
   * collection answers, without running. A plugin's attention item uses it for
   * a declared collection its reader may not read: their count of the others
   * stands, the item is not failed for a permission gap, and nothing about
   * that collection is disclosed.
   */
  answersNothing?: (slug: string) => boolean;
}

/** A call's own options, of which only the ones a read may carry are kept. */
interface ReadOptions {
  where?: unknown;
  sort?: unknown;
  limit?: unknown;
  select?: unknown;
  field?: unknown;
  range?: unknown;
  dateField?: unknown;
  status?: unknown;
  /** A count's window of time. */
  window?: unknown;
  /** Whether a list asks how many it matched in all. */
  total?: unknown;
  signal?: unknown;
}

/** The options a call names that its query carries as they are. */
type CarriedOption = "where" | "sort" | "limit" | "select" | "range";

/**
 * The options a read carries into its query, when the call states them, and
 * nothing else. Read from an object the call handed over, so anything else on
 * it is never looked at.
 */
function readOptionsOf(
  options: unknown,
  keys: readonly CarriedOption[]
): Record<string, unknown> {
  if (typeof options !== "object" || options === null) return {};
  const given = options as ReadOptions;
  const kept: Record<string, unknown> = {};
  for (const key of keys) {
    if (given[key] !== undefined) kept[key] = given[key];
  }
  return kept;
}

/** One option the call names, read once, or `undefined` when it names none. */
function optionOf(options: unknown, key: keyof ReadOptions): unknown {
  return typeof options === "object" && options !== null
    ? (options as ReadOptions)[key]
    : undefined;
}

/**
 * The entries a read counts, as its query names them.
 *
 * 🔴 `"published"` and no status at all are one question, so they are sent as
 * one: the query names no status, and core reads a person's query with none as
 * the published entries (`resolveStatusFilter`), exactly as a status of
 * `"published"` would, and as every row of a collection with no lifecycle,
 * which an explicit `"published"` would be refused for. So a read that says
 * `"published"` asks what the same read saying nothing asks, on every
 * collection. `"all"` is the query's own `all`: drafts too.
 *
 * Anything else is refused before the read is checked: it is no statement
 * about any collection, so the refusal says nothing about one either.
 */
function statusOf(options: unknown): { status?: "all" } {
  const status = optionOf(options, "status");
  if (status === undefined || status === "published") return {};
  if (status === "all") return { status: "all" };
  throw NextlyError.invalidInput({
    message:
      'A widget\'s data read names a status other than "published" or "all".',
  });
}

/** The call's own signal, when it passed one, beside the card's. */
function signalOf(options: unknown, card: AbortSignal): AbortSignal {
  const own = optionOf(options, "signal");
  return own instanceof AbortSignal ? AbortSignal.any([card, own]) : card;
}

/**
 * The field a collection's entries divide by when a read names none: core's
 * one rule for it (`naturalGroupBy`), read from the collection as a card's
 * settings see it, the rule a card's Group by setting falls back to. So a
 * read and a card left to the collection group by the same field.
 *
 * `undefined` for a collection with no such field, or none at this slug: the
 * query then names no field and is refused by the check every read passes,
 * after the person's own check, as any read of that collection would be.
 */
function defaultGroupField(slug: string): string | undefined {
  const [published] = publishableContentSources([slug]);
  return published === undefined ? undefined : naturalGroupBy(published);
}

/**
 * The refusal a read made after the card gave up gets: its answer would reach
 * nothing, so it is not run at all.
 */
function cardGaveUp(): NextlyError {
  return new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: "This widget took too long to answer",
    logMessage: "a declared widget's data function read after its card gave up",
    logContext: { reason: "widget-read-after-abort" },
  });
}

/**
 * The fault a read whose answer is not the one it asked for gets: of another
 * kind, which `answerAsAsked` refuses before this is reached, so this says so
 * to the compiler; or a series counted in an interval no range is drawn in.
 */
function answeredOtherwise(asked: string): NextlyError {
  return NextlyError.internal({
    logContext: { reason: "widget-read-answered-another-op", asked },
  });
}

/** A read the binding's check passed: its query, its signal and the site's slug it reads. */
type CheckedRead = WidgetQuery & { signal: AbortSignal; slug: string };

/**
 * What an empty collection answers a checked read of each kind: no entries, no
 * rows, no groups, and a series at zero in every interval of its range, built
 * through the window the read itself takes (`rangeWindow`, then
 * `intervalWindow`), as a read of no rows answers it.
 */
function nothingThere(query: WidgetQuery, now: Date): WidgetResult {
  switch (query.op) {
    case "count":
      return { op: "count", total: 0 };
    case "list":
      // An empty collection's list matches nothing, so it counts nothing too.
      return { op: "list", items: [], total: 0 };
    case "groupBy":
      return { op: "groupBy", buckets: [] };
    case "timeseries": {
      if (!isTimeseriesRange(query.range)) {
        throw answeredOtherwise("timeseries");
      }
      const window = rangeWindow(query.range, now);
      return {
        op: "timeseries",
        points: intervalWindow(
          window.anchor,
          window.interval,
          window.intervals
        ).map(start => ({ start: start.toISOString(), count: 0 })),
        interval: window.interval,
      };
    }
    default:
      throw answeredOtherwise(query.op);
  }
}

/** A read's option that may only be `true`, read once, or `false` when the call states none. */
function onlyTrue(options: unknown, key: "total"): boolean {
  const value = optionOf(options, key);
  if (value === undefined) return false;
  if (value === true) return true;
  throw NextlyError.invalidInput({
    message: `A widget's data read names a "${key}" other than true.`,
  });
}

/** A count's window, as the call states it, once its shape is known to be one. */
interface CountWindow {
  range: TimeseriesRange;
  dateField: string;
  previous: boolean;
}

/**
 * The window a count reads over, or `undefined` when the call states none.
 * Refused, before anything is checked, when it is not one: a range a series is
 * drawn over, a field's name, and `previous` only ever `true`.
 */
function windowOf(options: unknown): CountWindow | undefined {
  const window = optionOf(options, "window");
  if (window === undefined) return undefined;
  const given =
    typeof window === "object" && window !== null
      ? (window as { range?: unknown; dateField?: unknown; previous?: unknown })
      : undefined;
  const { range, dateField, previous } = given ?? {};
  if (
    given === undefined ||
    !isTimeseriesRange(range) ||
    (dateField !== undefined && typeof dateField !== "string") ||
    (previous !== undefined && previous !== true)
  ) {
    throw NextlyError.invalidInput({
      message:
        "A widget's count names a window that is not a range with an optional dateField and previous: true.",
    });
  }
  return {
    range,
    // Placed by when each entry was made, unless the call says.
    dateField: dateField ?? "createdAt",
    previous: previous === true,
  };
}

/**
 * The instants a count's window spans, `[from, to)`: the window a series over
 * the same range is drawn across (`rangeWindow`), from the instant the range
 * reaches back to the batch's; or, for `previous`, the window as long that ends
 * where that one starts.
 */
function windowSpan(window: CountWindow, now: Date): { from: Date; to: Date } {
  const { start } = rangeWindow(window.range, now);
  // The current window keeps the batch's instant's whole second, as a series
  // over the range does (`openWindowEnd`); the previous one ends at `start`.
  if (!window.previous) return { from: start, to: openWindowEnd(now) };
  return {
    from: new Date(start.getTime() - (now.getTime() - start.getTime())),
    to: start,
  };
}

/**
 * `where` narrowed to the entries whose `field` falls in `[from, to)`, joined
 * under `and` so a condition the call places on the same field still applies,
 * and a top-level key the collection reads stays where it is read.
 */
function withinSpan(
  where: unknown,
  field: string,
  { from, to }: { from: Date; to: Date }
): Record<string, unknown> {
  const span = {
    [field]: {
      greater_than_equal: from.toISOString(),
      less_than: to.toISOString(),
    },
  };
  if (typeof where !== "object" || where === null) return { and: [span] };
  const given = where as Record<string, unknown>;
  const joined = Array.isArray(given.and) ? given.and : [];
  return { ...given, and: [...joined, span] };
}

/**
 * Refuses a read that places entries by a field that is not a date field of
 * the collection readable by everyone the collection is read by: judged from
 * the collection as its content settings see it (`publishableContentSources`),
 * which leaves out every field a read rule could refuse. The same answer for
 * every reader, so it is given before a binding answers "nothing there", and
 * says nothing about any one person's access.
 */
function refuseUnreadableDate(slug: string, dateField: string): void {
  const [published] = publishableContentSources([slug]);
  const field = published?.fields.find(each => each.name === dateField);
  if (field?.type === "date") return;
  throw NextlyError.invalidInput({
    message: `A widget's data read places entries by "${dateField}", which is not a date field of this collection that every reader may read.`,
  });
}

/** The read services for one card, bound to `binding`. */
export function bindReadServices(
  binding: ReadServiceBinding
): WidgetReadServices {
  const {
    caller,
    prepare,
    signal: card,
    now,
    collections,
    answersNothing,
  } = binding;

  /**
   * The one path every read takes: the card is still waiting, the call names
   * a collection, and the query, shaped for the site's slug, is checked as a
   * card's own is before anything runs.
   */
  async function read(
    collection: unknown,
    shape: (slug: string) => Record<string, unknown>,
    options: unknown
  ): Promise<CheckedRead> {
    const signal = signalOf(options, card);
    if (signal.aborted) throw cardGaveUp();
    if (typeof collection !== "string" || collection.trim() === "") {
      throw NextlyError.invalidInput({
        message: "A widget's data read names no collection.",
      });
    }
    const slug = renamedCollection(collection, collections);
    const query = await prepare({
      ...shape(slug),
      source: `collection:${slug}`,
    });
    // Checked again after the check, which awaited: a card that gave up
    // meanwhile has no one to answer.
    if (signal.aborted) throw cardGaveUp();
    return { ...query, signal, slug };
  }

  /**
   * Runs a checked query as the person bound, its answer judged against what
   * was asked, as a source's answer is, so a read that answered anything else
   * is a fault, never a quiet empty answer.
   */
  async function run({
    signal,
    slug,
    ...query
  }: CheckedRead): Promise<WidgetResult> {
    // After the check, never instead of it: see `answersNothing`.
    if (answersNothing?.(slug) === true) {
      return answerAsAsked(query, nothingThere(query, now));
    }
    return answerAsAsked(
      query,
      await executeWidgetQuery(query, caller, { signal, now: new Date(now) })
    );
  }

  const services: WidgetReadServices = {
    async count(collection, options) {
      const window = windowOf(options);
      const checked = await read(
        collection,
        () => {
          const { where } = readOptionsOf(options, ["where"]);
          return {
            op: "count",
            // A window narrows the call's own `where` to the span it reads.
            ...(window === undefined
              ? where === undefined
                ? {}
                : { where }
              : {
                  where: withinSpan(
                    where,
                    window.dateField,
                    windowSpan(window, now)
                  ),
                }),
            ...statusOf(options),
          };
        },
        options
      );
      if (window !== undefined) {
        refuseUnreadableDate(checked.slug, window.dateField);
      }
      const answer = await run(checked);
      return answer.op === "count" ? answer.total : 0;
    },
    async find(collection, options) {
      const counted = onlyTrue(options, "total");
      // 🔴 A limit of 0 asks for no rows: what `rowsThatFit` answers for a
      // card whose body holds none, and what that card's frame draws. A query
      // runs at one row at the least, so the read is asked at one, checked as
      // any read is, and answered with none. Nothing is run when the call asks
      // no total either.
      const none = optionOf(options, "limit") === 0;
      const checked = await read(
        collection,
        () => ({
          op: "list",
          ...readOptionsOf(options, ["where", "sort", "limit", "select"]),
          ...(none ? { limit: 1 } : {}),
          ...statusOf(options),
        }),
        options
      );
      if (none && !counted) return { items: [] };
      const answer = await run(checked);
      // As the browser would receive them, so the function may answer them
      // as they are and the card's transport check passes.
      const sent = sentAsJson(
        answer.op === "list" && !none ? answer.items : []
      );
      // How many the same read matched, only where the call asked for it.
      const total = counted && answer.op === "list" ? answer.total : undefined;
      return {
        items: sentRows(sent),
        ...(total === undefined ? {} : { total }),
        ...(total !== undefined &&
        answer.op === "list" &&
        answer.atLeast === true
          ? { atLeast: true }
          : {}),
      };
    },
    async groupBy(collection, options) {
      const answer = await run(
        await read(
          collection,
          slug => {
            // The call's own field, or the collection's own grouping.
            const named = optionOf(options, "field");
            const field = named === undefined ? defaultGroupField(slug) : named;
            return {
              op: "groupBy",
              ...(field === undefined ? {} : { groupBy: field }),
              ...readOptionsOf(options, ["where", "limit"]),
              ...statusOf(options),
            };
          },
          options
        )
      );
      if (answer.op !== "groupBy") throw answeredOtherwise("groupBy");
      // Each bucket as the `bars` view draws it: its value and its count; and
      // whether groups were left out, or the counts are floors, as the read
      // reports them, only when it does.
      return {
        buckets: answer.buckets.map(({ value, count }) => ({ value, count })),
        ...(answer.truncated === true ? { truncated: true } : {}),
        ...(answer.atLeast === true ? { atLeast: true } : {}),
      };
    },
    async timeseries(collection, options) {
      const named = optionOf(options, "dateField");
      // Placed by when each entry was made, unless the call says.
      const dateField = named === undefined ? "createdAt" : named;
      const checked = await read(
        collection,
        () => ({
          op: "timeseries",
          dateField,
          ...readOptionsOf(options, ["range", "where"]),
          ...statusOf(options),
        }),
        options
      );
      // The check above refuses a field that is not a date; a date some
      // reader could be refused is refused here, the same for everyone.
      if (typeof dateField === "string") {
        refuseUnreadableDate(checked.slug, dateField);
      }
      const answer = await run(checked);
      // A series over a range is counted in the interval its range sets, so
      // any other is a fault, said rather than passed on as a range's.
      if (answer.op !== "timeseries" || !isRangeInterval(answer.interval)) {
        throw answeredOtherwise("timeseries");
      }
      // The interval the points were counted in, as the run reports it: the
      // one its range set (`rangeWindow`), never worked out a second time.
      return {
        points: answer.points.map(({ start, count }) => ({ start, count })),
        interval: answer.interval,
      };
    },
    async describe(collection) {
      // Checked as a read of the collection is, so a collection the person
      // may not read is refused as any read of it would be.
      const { slug } = await read(collection, () => ({ op: "count" }), {});
      // After the check, never instead of it: see `answersNothing`.
      if (answersNothing?.(slug) === true) return undefined;
      // As a card's content settings see the collection: every field a read
      // rule could refuse is left out, and the title only where it is not.
      const [published] = publishableContentSources([slug]);
      if (published === undefined) return undefined;
      return {
        ...(published.titleField === undefined
          ? {}
          : { title: published.titleField }),
        status: published.lifecycle,
        fields: published.fields.map(
          ({ name, label, type, choices, groupable, presentable }) => ({
            name,
            type,
            // The collection's own label, else the field's name as the admin
            // names it on screen, by the one humaniser both read.
            label: label ?? humanizeFieldName(name),
            ...(choices === undefined ? {} : { choices }),
            ...(groupable === false ? { groupable: false as const } : {}),
            ...(presentable === false ? { presentable: false as const } : {}),
          })
        ),
      };
    },
  };
  return services;
}
