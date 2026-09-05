/**
 * Every visible widget's data request, in as few round trips as the endpoint
 * allows.
 *
 * `POST /api/dashboard/query` takes `{ queries: WidgetQuery[] }` and answers
 * `{ results }` POSITIONALLY — `results[i]` belongs to `queries[i]` and carries
 * no widget id of its own. Re-keying that back onto widget ids is this hook's
 * whole job, and it is the reason a dashboard of ten cards costs one request
 * rather than ten.
 *
 * It also REFUSES a body above `MAX_QUERIES_PER_REQUEST`, so "one request for
 * everything" stops being correct at the thirty-first widget: a single batch
 * would be rejected whole and every widget on the dashboard would go dark at
 * once, over a limit none of them individually crossed. The requests are
 * therefore partitioned to that size, and the partition is a property of the
 * TRANSPORT rather than of the dashboard — each partition is its own query, its
 * own retry and its own failure, and a widget's slot comes back from whichever
 * one carried it.
 *
 * Refresh follows `useDashboardStats` exactly: `staleTime: 0`, refetch on mount
 * and on window focus, and NO polling interval. The UX evidence is against
 * aggressive auto-refresh; a dashboard that moves on its own is a dashboard
 * nobody can read.
 *
 * @module hooks/queries/useWidgetQueries
 */

import { useQueries } from "@tanstack/react-query";
import {
  MAX_QUERIES_PER_REQUEST,
  WIDGET_SOURCE_FIELD_TYPES,
  type WidgetQuery,
} from "nextly/config";
import { useMemo } from "react";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type {
  WidgetQueryBatchResponse,
  WidgetResult,
  WidgetResultField,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

/** One widget's request: the id to key the answer back to, and what to ask. */
export interface WidgetQueryRequest {
  widgetId: string;
  /**
   * Which of the widget's cells this answer belongs to, for a `stats` card.
   *
   * Absent for every archetype that asks ONE question, so their slot key stays
   * the bare widget id and every existing reader is untouched.
   */
  cellKey?: string;
  query: WidgetQuery;
}

/** One card's cell answers, keyed by cell key. */
export type CellSlots = Record<string, Record<string, WidgetSlot>>;

export interface UseWidgetQueriesResult {
  /** Keyed by `widgetId`. A widget with no answer yet is simply absent. */
  slots: Record<string, WidgetSlot>;
  /** Keyed by `widgetId`, then by cell key. Only `stats` cards appear here. */
  cellSlots: CellSlots;
  isLoading: boolean;
  /**
   * Whether any request is in flight, INCLUDING a background refetch that is
   * keeping its previous answer on screen.
   *
   * Distinct from `isLoading`, which is only ever true before there is anything
   * to show. On window focus this grid refetches while the cards keep their
   * numbers, and a reader has no way to know that is happening unless the card
   * says so — which is what `aria-busy` is for.
   */
  isFetching: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
  /**
   * When the data on screen landed, or `null` before all of it has.
   *
   * The OLDEST partition's answer, not the newest. Every card reads one
   * freshness line, so it has to be true of every card: taking the newest would
   * let a partition that answered ten minutes ago sit under a timestamp from a
   * partition that answered a second ago.
   */
  updatedAt: Date | null;
}

/**
 * A dictionary with NO prototype, for keys this code does not control.
 *
 * 🔴 A contributed widget id is checked only for being usable text, so `id` may
 * be `"__proto__"` -- and on a `{}` dictionary that key is not data. Reading it
 * returns `Object.prototype`, so `dict[id] ??= {}` never assigns and the cell
 * key is written onto the prototype every object in the admin inherits;
 * assigning it directly replaces the dictionary's own prototype instead of
 * storing an entry. Either way one widget's answer becomes visible to
 * unrelated code, from nothing more than receiving a response. `constructor`
 * and `toString` misbehave for the same reason without the global damage.
 *
 * A null prototype makes every key data. `Object.keys`, `in` and index reads all
 * behave as they already did for ordinary ids, so nothing downstream changes.
 */
function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/**
 * Files one answer where its widget will look for it.
 *
 * 🔴 Two maps rather than one map with a composite key. A contributed widget id
 * is checked only for being usable TEXT, not against the registry's slug
 * pattern, so it may contain any character -- including whichever separator a
 * composite key chose. `core/a` cell `b` and a contributed widget literally
 * named `core/a#b` would then file into the same entry and one card would draw
 * the other's number. Nesting removes the encoding, and with it the class of
 * bug: there is no string to collide.
 */
function fileAnswer(
  slots: Record<string, WidgetSlot>,
  cellSlots: CellSlots,
  entry: WidgetQueryRequest,
  slot: WidgetSlot
): void {
  if (entry.cellKey === undefined) {
    slots[entry.widgetId] = slot;
    return;
  }
  (cellSlots[entry.widgetId] ??= emptyRecord())[entry.cellKey] = slot;
}

/** What a widget is told when the batch came back shorter than it went out. */
const MISSING_SLOT_ERROR = "The server returned no result for this widget.";

/** What a widget is told when its entry is not shaped like a slot at all. */
const MALFORMED_SLOT_ERROR =
  "The server returned an unreadable result for this widget.";

/**
 * What every widget in a batch is told when the REQUEST itself failed.
 *
 * A settled-and-failed request must produce slots, not an absence. A widget
 * with no slot is BUSY by the renderer's contract -- which is right while the
 * batch is in flight and wrong once it has failed, and the difference is
 * invisible from the card: every data widget on the dashboard sat spinning
 * forever, with only the grid's live region saying anything had gone wrong.
 *
 * A fixed sentence rather than the transport's own message. The per-slot errors
 * the server sends are written to be read by an admin; a rejected request
 * carries whatever the network, a proxy or a changed envelope produced, and
 * putting that on ten cards at once turns the card into a channel for text
 * nobody wrote for it. What actually failed travels in `error`, where the grid
 * reads it.
 */
const BATCH_FAILED_ERROR = "Dashboard data could not be loaded.";

/**
 * Narrows the response body before anything is keyed from it.
 *
 * The alternative — trusting `results` and indexing it — turns a proxy error
 * page or a changed envelope into a dashboard of cards stuck loading forever,
 * with nothing anywhere saying why. Failing the query instead puts the failure
 * where `error` is read.
 */
/**
 * One member of `results` as a slot, or a failed slot saying it was not one.
 *
 * `Array.isArray` says nothing about the MEMBERS, and every one of them is
 * dereferenced downstream: `WidgetRenderer` reads `slot.ok` and then hands
 * `slot.result` to an archetype body, which reads `result.op`. So
 * `{ "results": [{ "ok": true }] }` threw a `TypeError` out of the renderer and
 * into the dashboard's error boundary -- one malformed entry replacing the
 * entire page, which is the exact blast radius the per-slot shape exists to
 * prevent. `{ "results": [42] }` was quieter and no better: `ok` was absent, so
 * the card took the failure branch with `undefined` where its message goes and
 * drew a blank body with nothing wrong on it.
 *
 * The DISCRIMINATOR is checked before anything branches on it, because a member
 * carrying neither `true` nor `false` there is not a slot in either direction.
 *
 * `result` is then checked AGAINST ITS OWN `op`, and this is the part that was
 * too shallow. Checking it was an object earned nothing: `WidgetResult` is a
 * discriminated union whose arms carry a `total: number` and an
 * `items: Record<string, unknown>[]`, and `{ "op": "count" }` satisfies
 * "is an object" while satisfying neither arm. The cast then said it was a
 * `WidgetResult`, `metricBody` read `result.total.toLocaleString()` on
 * `undefined`, and the `TypeError` left the whole grid replaced by an error
 * page -- the exact blast radius the per-slot shape exists to prevent.
 *
 * A payload of the WRONG op is a different thing and is deliberately still let
 * through: a `list` handed to a metric widget is a well-formed result that the
 * archetype refuses by name, and its sentence -- naming the widget and both
 * ops -- is a better one than anything this function could write. What is
 * refused here is a result that is not a `WidgetResult` at all, because no
 * archetype can be handed one safely.
 */
function asSlot(value: unknown): WidgetSlot {
  if (value === undefined || value === null) {
    return { ok: false, error: MISSING_SLOT_ERROR };
  }
  if (!isObject(value)) return malformed();

  const slot = value as { ok?: unknown; error?: unknown; result?: unknown };

  if (slot.ok === false) return refusal(slot.error);
  if (slot.ok !== true) return malformed();

  const result = asResult(slot.result);
  if (result === undefined) return malformed();

  return { ok: true, result };
}

/**
 * The server's column descriptions, or `undefined`.
 *
 * Checked like everything else that crosses this boundary: a descriptor with no
 * usable `name` describes no column, and a `label` that is not a string is not
 * a heading. A malformed `fields` costs the columns and nothing more -- the
 * rows are the answer, and refusing the whole result over its headings would
 * turn a cosmetic problem into a blank card.
 *
 * This function exists because the previous arm rebuilt a list result as
 * `{ op, items }` and nothing else, which silently discarded the field
 * descriptions the moment the server started sending them. Its own docblock
 * said this is "the place that has to grow when the result contract does" --
 * and then the contract grew.
 */
/**
 * The field kinds a result may name, DERIVED from core's vocabulary.
 *
 * 🔴 Not a hand-kept list. The wire's `type` is a `WidgetSourceFieldType`, whose
 * canonical tuple lives in core, and restating the strings here meant the two
 * could disagree in the one direction nobody notices: core adds a presentable
 * kind, the server emits it, and this parser silently erases it -- so the cell
 * falls back to raw text with the new presentation quietly missing and nothing
 * reporting a loss.
 *
 * The set still exists rather than trusting the wire, because this parses
 * UNTRUSTED JSON: what arrives has to be checked against the vocabulary, and
 * deriving the vocabulary from core is what makes that check track core.
 */
const KNOWN_FIELD_TYPES: ReadonlySet<string> = new Set(
  WIDGET_SOURCE_FIELD_TYPES
);

function asResultFields(value: unknown): WidgetResultField[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const described: WidgetResultField[] = [];
  for (const raw of value) {
    if (!isObject(raw)) return undefined;
    const field = raw as { name?: unknown; label?: unknown; type?: unknown };
    if (typeof field.name !== "string" || field.name === "") return undefined;
    if (field.label !== undefined && typeof field.label !== "string") {
      return undefined;
    }
    /*
     * An unrecognised kind is DROPPED, not refused. `label` above rejects the
     * whole list on a wrong shape because a non-string label is a server that
     * is broken; a type this admin does not know is a server that is NEWER, and
     * blanking the card over it would make every future type a breaking change.
     * Falling back to plain text is what the renderer did before types existed.
     */
    const type = KNOWN_FIELD_TYPES.has(field.type as string)
      ? (field.type as WidgetResultField["type"])
      : undefined;
    described.push({
      name: field.name,
      ...(field.label !== undefined && { label: field.label }),
      ...(type !== undefined && { type }),
    });
  }

  return described.length > 0 ? described : undefined;
}

/**
 * One `result` payload as the union it claims to be, or `undefined`.
 *
 * Narrowed by construction rather than asserted: each arm returns a fresh
 * object built from the fields it just checked, so what the caller receives is
 * a `WidgetResult` because it was assembled as one -- not because a cast said
 * so over a value nobody looked at.
 *
 * A non-finite `total` is refused with a missing one, and this is REACHABLE
 * over the real transport. JSON has no literal for `Infinity`, which is what
 * made it tempting to skip -- but `1e400` is valid JSON, `JSON.parse` answers
 * `Infinity`, `typeof` says `"number"`, and `toLocaleString` renders it as a
 * lone infinity sign where a count belongs. Nothing throws, so this is the
 * shape that would have shipped a wrong number stated confidently rather than a
 * card admitting it could not answer. (`NaN` genuinely has no JSON spelling,
 * and is guarded only because the same predicate covers it.)
 *
 * An `op` this admin does not know is refused. There is no arm to build and no
 * archetype that could draw it, so the honest answer is the malformed one.
 *
 * The arms are rebuilt from the checked fields, which NARROWS what a `custom`
 * widget's component receives through `PluginSlot` to exactly the fields this
 * union names. That is intentional while the union is closed here and in
 * `domains/widgets/execute`; an admin talking to a newer server that added a
 * field to a result would drop it before the plugin saw it, so this function is
 * the place that has to grow when the result contract does.
 */
/**
 * A count result, or `undefined` when the payload does not carry one.
 *
 * `atLeast` is carried through rather than dropped: it says the total is a
 * FLOOR, and a card that loses it renders a partial figure as though it were the
 * whole answer.
 */
function asCount(total: unknown, atLeast: unknown): WidgetResult | undefined {
  if (typeof total !== "number" || !Number.isFinite(total)) return undefined;
  return {
    op: "count",
    total,
    ...(atLeast === true ? { atLeast: true } : {}),
  };
}

function asResult(value: unknown): WidgetResult | undefined {
  if (!isObject(value)) return undefined;

  const result = value as {
    op?: unknown;
    total?: unknown;
    atLeast?: unknown;
    items?: unknown;
    fields?: unknown;
  };

  if (result.op === "count") return asCount(result.total, result.atLeast);

  if (result.op === "list") {
    // The MEMBERS as well as the array, because a row is dereferenced per field
    // by whatever draws it, and `[null]` is an array that fails there rather
    // than here -- the same shape as the `total` above, one level down.
    if (!Array.isArray(result.items)) return undefined;
    const items: unknown[] = result.items;
    if (!items.every(isObject)) return undefined;
    const fields = asResultFields(result.fields);
    return { op: "list", items, ...(fields && { fields }) };
  }

  return undefined;
}

/**
 * Whether a value can be read as the object a slot or a result must be.
 *
 * A type PREDICATE rather than a boolean, so `items.every(isObject)` narrows
 * the array it just checked. Returning a plain boolean left the list arm ending
 * in a cast the compiler could not verify -- in the one function whose docblock
 * says its arms are built from checked fields rather than asserted.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The refusal a member gets when it is not a slot at all. */
function malformed(): WidgetSlot {
  return { ok: false, error: MALFORMED_SLOT_ERROR };
}

/**
 * A declared failure, carrying the server's own message.
 *
 * A slot that says `ok: false` and supplies no readable message is still a
 * failure -- refusing to show it would be a second, silent one -- so it falls
 * back rather than being discarded.
 */
function refusal(error: unknown): WidgetSlot {
  const usable = typeof error === "string" && error.trim() !== "";
  return { ok: false, error: usable ? error : MALFORMED_SLOT_ERROR };
}

function readResults(body: unknown): unknown[] {
  const results = (body as WidgetQueryBatchResponse | null)?.results;
  if (!Array.isArray(results)) {
    throw new Error(
      "Dashboard query response was not shaped as { results: [] }."
    );
  }
  return results;
}

/**
 * The requests split into batches the endpoint will accept.
 *
 * Chunked in ORDER, so a widget's position inside its partition is what the
 * positional response is keyed back through, and a dashboard that grows past
 * the limit does not reshuffle which request its existing widgets travel in.
 *
 * An empty input produces NO partitions, which is what keeps a dashboard with
 * nothing to ask from issuing a request: an empty batch would still cost a
 * round trip, an authentication check and a log line on every mount and every
 * window focus, for an answer that is knowable without asking.
 */
function partitionRequests(
  queries: WidgetQueryRequest[]
): WidgetQueryRequest[][] {
  const partitions: WidgetQueryRequest[][] = [];
  for (
    let start = 0;
    start < queries.length;
    start += MAX_QUERIES_PER_REQUEST
  ) {
    partitions.push(queries.slice(start, start + MAX_QUERIES_PER_REQUEST));
  }
  return partitions;
}

/**
 * Batches `queries` into as few requests as the endpoint allows and hands each
 * widget back its own slot.
 */
export function useWidgetQueries(
  queries: WidgetQueryRequest[]
): UseWidgetQueriesResult {
  const partitions = useMemo(() => partitionRequests(queries), [queries]);

  const results = useQueries({
    queries: partitions.map(partition => ({
      // The partition's own requests are its key. Two dashboards asking for
      // different widgets are different questions and must not share one cache
      // entry; TanStack hashes the array deterministically, so a re-render with
      // an equal-but-new array does not refetch.
      queryKey: ["dashboard", "widget-queries", partition],
      queryFn: async () => {
        const body = await protectedApi.post<unknown>("/dashboard/query", {
          queries: partition.map(entry => entry.query),
        });
        return readResults(body);
      },
      staleTime: 0,
      gcTime: 5 * 60 * 1000,
      retry: 2,
      refetchOnMount: "always" as const,
      refetchOnWindowFocus: true,
    })),
  });

  // Not memoized, and deliberately: `useQueries` builds a fresh result array on
  // every render, so a memo keyed on it would recompute every render anyway
  // while reading as though it did not. The walk is one pass over the widgets.
  // Both dictionaries are keyed by caller-supplied ids; see `emptyRecord`.
  const slots: Record<string, WidgetSlot> = emptyRecord();
  const cellSlots: CellSlots = emptyRecord();
  partitions.forEach((partition, index) => {
    const answer = results[index];
    if (!answer) return;

    if (answer.data) {
      partition.forEach((entry, position) => {
        // A short response is the server disagreeing with us about how many
        // questions were asked, and a member that is not a slot is it
        // disagreeing about the shape. Saying so per widget is what stops the
        // trailing cards spinning silently forever -- and what keeps one bad
        // entry from throwing out of the renderer and taking the page with it.
        fileAnswer(slots, cellSlots, entry, asSlot(answer.data[position]));
      });
      return;
    }

    // Answered by failing. Every widget in THIS partition gets its own failed
    // slot, because a card cannot tell an absent slot from a pending one and
    // renders both as busy — and only this partition's widgets are affected,
    // which is the point of splitting them. Data already held wins over this
    // branch, so a refetch that fails on window focus keeps the numbers the
    // reader was looking at.
    if (answer.isError) {
      partition.forEach(entry => {
        fileAnswer(slots, cellSlots, entry, {
          ok: false,
          error: BATCH_FAILED_ERROR,
        });
      });
    }
  });

  const settledAt = results.map(answer => answer.dataUpdatedAt);

  return {
    slots,
    cellSlots,
    isLoading: results.some(answer => answer.isLoading),
    isFetching: results.some(answer => answer.isFetching),
    // The FIRST failure, which is enough for the grid: what a reader needs per
    // widget is already in that widget's slot, and this says only that
    // something in the batch did not answer.
    error: results.find(answer => answer.error)?.error ?? null,
    refetch: () => Promise.all(results.map(answer => answer.refetch())),
    // `dataUpdatedAt` is 0 until a partition has resolved once, which is not an
    // instant in 1970 -- it is the absence of one. A single unresolved
    // partition makes the whole line absent rather than wrong.
    updatedAt:
      settledAt.length > 0 && settledAt.every(at => at > 0)
        ? new Date(Math.min(...settledAt))
        : null,
  };
}
