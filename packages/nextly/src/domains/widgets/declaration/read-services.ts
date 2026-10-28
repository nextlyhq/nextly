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
import { NextlyError } from "../../../errors/nextly-error";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { answerAsAsked } from "../answer-as-asked";
import { executeWidgetQuery } from "../execute";
import { publishableContentSources } from "../publish";
import { isRangeInterval, type WidgetQuery } from "../query";
import type { WidgetResult } from "../result";
import { naturalGroupBy } from "../settings";

import { renamedCollection } from "./card-settings";
import type { WidgetReadServices } from "./define-widget";
import { sentAsJson, type TransportableValue } from "./transportable";

/** One row as a data function receives it. */
type Row = { readonly [field: string]: TransportableValue };

/** Whether a value arrived as a row: an object of fields, not a list. */
const isRow = (value: TransportableValue): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

/** The read services for one card, bound to `binding`. */
export function bindReadServices(
  binding: ReadServiceBinding
): WidgetReadServices {
  const { caller, prepare, signal: card, now, collections } = binding;

  /**
   * The one path every read takes: the card is still waiting, the call names
   * a collection, and the query, shaped for the site's slug, is checked as a
   * card's own is before anything runs.
   */
  async function read(
    collection: unknown,
    shape: (slug: string) => Record<string, unknown>,
    options: unknown
  ): Promise<WidgetQuery & { signal: AbortSignal }> {
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
    return { ...query, signal };
  }

  /**
   * Runs a checked query as the person bound, its answer judged against what
   * was asked, as a source's answer is, so a read that answered anything else
   * is a fault, never a quiet empty answer.
   */
  async function run({
    signal,
    ...query
  }: WidgetQuery & { signal: AbortSignal }): Promise<WidgetResult> {
    return answerAsAsked(
      query,
      await executeWidgetQuery(query, caller, { signal, now: new Date(now) })
    );
  }

  return {
    async count(collection, options) {
      const answer = await run(
        await read(
          collection,
          () => ({
            op: "count",
            ...readOptionsOf(options, ["where"]),
            ...statusOf(options),
          }),
          options
        )
      );
      return answer.op === "count" ? answer.total : 0;
    },
    async find(collection, options) {
      const answer = await run(
        await read(
          collection,
          () => ({
            op: "list",
            ...readOptionsOf(options, ["where", "sort", "limit", "select"]),
            ...statusOf(options),
          }),
          options
        )
      );
      // As the browser would receive them, so the function may answer them
      // as they are and the card's transport check passes.
      const sent = sentAsJson(answer.op === "list" ? answer.items : []);
      return { items: Array.isArray(sent) ? sent.filter(isRow) : [] };
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
      // Each bucket as the `bars` view draws it: its value and its count.
      return {
        buckets: answer.buckets.map(({ value, count }) => ({ value, count })),
      };
    },
    async timeseries(collection, options) {
      const answer = await run(
        await read(
          collection,
          () => {
            const dateField = optionOf(options, "dateField");
            return {
              op: "timeseries",
              // Placed by when each entry was made, unless the call says.
              dateField: dateField === undefined ? "createdAt" : dateField,
              ...readOptionsOf(options, ["range", "where"]),
              ...statusOf(options),
            };
          },
          options
        )
      );
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
  };
}
