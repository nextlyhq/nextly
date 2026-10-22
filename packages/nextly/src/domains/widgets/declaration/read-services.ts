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
import type { WidgetQuery } from "../query";

import { renamedCollection } from "./card-query";
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
  /** The owner's collections the site renamed: declared slug to the site's. */
  collections?: Readonly<Record<string, string>>;
}

/** A call's own options, of which only the ones a read may carry are kept. */
interface ReadOptions {
  where?: unknown;
  sort?: unknown;
  limit?: unknown;
  select?: unknown;
  signal?: unknown;
}

/**
 * The options a read carries into its query: `where`, `sort`, `limit` and
 * `select`, when the call states them, and nothing else. Read from an object
 * the call handed over, so anything else on it is never looked at.
 */
function readOptionsOf(
  options: unknown,
  keys: readonly ("where" | "sort" | "limit" | "select")[]
): Record<string, unknown> {
  if (typeof options !== "object" || options === null) return {};
  const given = options as ReadOptions;
  const kept: Record<string, unknown> = {};
  for (const key of keys) {
    if (given[key] !== undefined) kept[key] = given[key];
  }
  return kept;
}

/** The call's own signal, when it passed one, beside the card's. */
function signalOf(options: unknown, card: AbortSignal): AbortSignal {
  const own =
    typeof options === "object" && options !== null
      ? (options as ReadOptions).signal
      : undefined;
  return own instanceof AbortSignal ? AbortSignal.any([card, own]) : card;
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

/** The read services for one card, bound to `binding`. */
export function bindReadServices(
  binding: ReadServiceBinding
): WidgetReadServices {
  const { caller, prepare, signal: card, collections } = binding;

  async function read(
    collection: unknown,
    shape: Record<string, unknown>,
    options: unknown
  ): Promise<WidgetQuery & { signal: AbortSignal }> {
    const signal = signalOf(options, card);
    if (signal.aborted) throw cardGaveUp();
    if (typeof collection !== "string" || collection.trim() === "") {
      throw NextlyError.invalidInput({
        message: "A widget's data read names no collection.",
      });
    }
    const query = await prepare({
      ...shape,
      source: `collection:${renamedCollection(collection, collections)}`,
    });
    // Checked again after the check, which awaited: a card that gave up
    // meanwhile has no one to answer.
    if (signal.aborted) throw cardGaveUp();
    return { ...query, signal };
  }

  return {
    async count(collection, options) {
      const { signal, ...query } = await read(
        collection,
        { op: "count", ...readOptionsOf(options, ["where"]) },
        options
      );
      // Judged against what was asked, as a source's answer is, so a count
      // that answered anything else is a fault, never a quiet zero.
      const answer = answerAsAsked(
        query,
        await executeWidgetQuery(query, caller, { signal })
      );
      return answer.op === "count" ? answer.total : 0;
    },
    async find(collection, options) {
      const { signal, ...query } = await read(
        collection,
        {
          op: "list",
          ...readOptionsOf(options, ["where", "sort", "limit", "select"]),
        },
        options
      );
      const answer = answerAsAsked(
        query,
        await executeWidgetQuery(query, caller, { signal })
      );
      // As the browser would receive them, so the function may answer them
      // as they are and the card's transport check passes.
      const sent = sentAsJson(answer.op === "list" ? answer.items : []);
      return { items: Array.isArray(sent) ? sent.filter(isRow) : [] };
    },
  };
}
