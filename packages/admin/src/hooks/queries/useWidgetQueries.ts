/**
 * Every visible card's data request, in as few round trips as the endpoint
 * allows.
 *
 * `POST /api/dashboard/query` takes `{ queries }`, one card ask per card (the
 * card by its id, or with the settings it is drawn with), and answers
 * `{ results }` POSITIONALLY — `results[i]` belongs to `queries[i]` and carries
 * no identity of its own. Re-keying that back onto the PLACEMENT that asked is
 * this hook's whole job, and it is the reason a dashboard of ten cards costs
 * one request rather than ten.
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

import {
  hashKey,
  useQueries,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import {
  isTimeseriesInterval,
  MAX_QUERIES_PER_REQUEST,
  WIDGET_SOURCE_FIELD_TYPES,
} from "nextly/config";
import type { WidgetRenderSize } from "nextly/widget-result";
import { useMemo } from "react";

import type {
  WidgetResult,
  WidgetResultField,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { WIDGET_QUERIES_KEY } from "./widget-queries-key";
import {
  fetchWidgetBatch,
  type CardAsk,
  type SentCardAsk,
} from "./widget-query-stream";

export type { CardAsk } from "./widget-query-stream";

/** One card's request: the placement to key the answer back to, and the card to ask for. */
export interface WidgetQueryRequest {
  /**
   * Which PLACEMENT asked, not which widget.
   *
   * 🔴 The widget id cannot key an answer, because it does not identify a
   * question. `WidgetPlacement` is a full snapshot with its own identity
   * precisely so one widget can sit on a dashboard twice carrying different
   * `config` — and a setting the widget's `load` reads makes those two cards
   * genuinely different questions. Keyed by widget, both filed into one entry:
   * the second response overwrote the first and both cards drew the same rows,
   * each reader's own choice visible on neither.
   *
   * A placement id is unique within a layout and opaque, so it needs no
   * composite key and no encoding.
   */
  placementId: string;
  /**
   * The card core answers on the server from its widget's declaration: by its id while it is
   * stored, or with the settings it is drawn with while those may be unsaved.
   */
  card: CardAsk;
  /**
   * The size the card is drawn at: its grid size and the tier predicted for it, sent beside
   * `card` and handed to the widget's `load`, which may read it.
   *
   * 🔴 Part of what the answer is filed as asked with (`appliedKey`), and kept out of the cache
   * key. The size a load saw is part of its answer's identity, so a card resized or crossing a
   * tier asks again; filed by `appliedKey` it asks again ALONE (`useCardRetries`), while a size
   * in the key would make one card's resize a new question for its whole partition.
   */
  cardSize?: WidgetRenderSize;
  /**
   * The stored settings a card asked for by id was asked with: what its answer
   * is filed under, so a saved change of them asks this card again alone.
   */
  config?: Record<string, unknown>;
  /**
   * How many times this card's Retry has been pressed, for a retried card only.
   *
   * Part of the cache key and never sent: each press is a new question to the cache, so the card's
   * query is asked again even when the previous retry's answer is still cached.
   */
  attempt?: number;
}

/**
 * The question a request asks with, as one comparable string: what an answer is filed as having
 * been asked with, and what a card compares against when its settings change.
 *
 * A card's is its ask with the stored settings it was asked with and the size it is drawn at, so
 * a saved change of them, a resize or a change of tier is a different question, and a preview's
 * ask, which carries its own settings, never reads as the stored card's.
 */
export function appliedKey(request: WidgetQueryRequest): string {
  return JSON.stringify({
    card: request.card,
    config: request.config ?? null,
    // Its three numbers in one fixed order, so two equal sizes are one key however the object
    // holding them was built.
    size:
      request.cardSize === undefined
        ? null
        : [request.cardSize.w, request.cardSize.h, request.cardSize.tier],
  });
}

/** What an answer was asked with, as far as drawing it needs: its size and its settings. */
export interface AskedWith {
  /** The size it was asked at; absent for an answer asked with no size. */
  size?: WidgetRenderSize;
  /**
   * The settings it was asked with: those sent with the card, or the stored ones a card asked
   * for by its id was filed under. Absent where it was asked with neither.
   */
  settings?: Record<string, unknown>;
}

/**
 * What an answer was asked with, read back from what it is filed as asked with (`appliedKey`):
 * `undefined` for no answer.
 *
 * Read from the key rather than kept beside it, so what a held answer is drawn by and the
 * question a card's new size or settings is judged against are one record, and cannot disagree.
 */
export function askedIn(applied: string | undefined): AskedWith | undefined {
  if (applied === undefined) return undefined;
  const asked: unknown = JSON.parse(applied);
  if (typeof asked !== "object" || asked === null) return undefined;
  const size = "size" in asked ? sizeOf(asked.size) : undefined;
  const card = "card" in asked ? asked.card : undefined;
  const settings =
    recordOf(
      typeof card === "object" && card !== null && "settings" in card
        ? card.settings
        : undefined
    ) ?? recordOf("config" in asked ? asked.config : undefined);
  return {
    ...(size === undefined ? {} : { size }),
    ...(settings === undefined ? {} : { settings }),
  };
}

/** A size as `appliedKey` writes it, its three numbers in order, or `undefined` for none. */
function sizeOf(value: unknown): WidgetRenderSize | undefined {
  if (!Array.isArray(value)) return undefined;
  const [w, h, tier]: unknown[] = value;
  return typeof w === "number" &&
    typeof h === "number" &&
    (tier === "small" || tier === "medium" || tier === "large")
    ? { w, h, tier }
    : undefined;
}

/** Settings as `appliedKey` writes them, a plain object, or `undefined` for none. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value));
}

/** What one request sends as its entry of the batch: its card with the size it is drawn at. */
export function sentEntry(request: WidgetQueryRequest): SentCardAsk {
  return request.cardSize === undefined
    ? request.card
    : { ...request.card, size: request.cardSize };
}

export interface UseWidgetQueriesResult {
  /** Keyed by `placementId`. A card with no answer yet is simply absent. */
  slots: Record<string, WidgetSlot>;
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
  /**
   * The placements whose OWN answer is still on its way.
   *
   * `isFetching` above answers "is anything still loading", which is what the
   * grid's own busy affordance needs. A CARD needs its own answer: on a
   * dashboard split across partitions the two differ, and a card reading the
   * batch-wide flag stays dimmed while an unrelated partition loads. Within one
   * partition too, since each slot streams in as the server settles it: a card
   * whose slot this request has delivered is not waiting, though a slower card
   * in the same request still is. A card that asked nothing is never in a
   * partition, so it is never in this set.
   */
  fetchingPlacementIds: ReadonlySet<string>;
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
  /**
   * When the request this card was asked in last answered, or `null` before it has, or for a
   * card in no request.
   *
   * The card's OWN request's time, where `updatedAt` is the oldest of them: past
   * `MAX_QUERIES_PER_REQUEST` the requests answer separately, so the time of one card's newer
   * answer is not the batch's while another request's older answer stands.
   */
  answeredAtFor: (placementId: string) => Date | null;
  /**
   * What each placement's answer was asked with (see `appliedKey`), read from the answer, or
   * from a request that settled by failing; `undefined` while the first request is in flight.
   */
  fetchedAppliedFor: (placementId: string) => string | undefined;
}

/**
 * A dictionary with NO prototype, for keys this code does not control.
 *
 * 🔴 A contributed widget id is checked only for being usable text, so `id` may
 * be `"__proto__"` -- and on a `{}` dictionary that key is not data. Reading it
 * returns `Object.prototype`, so reading it hands back a "slot" no answer
 * carried; assigning it directly replaces the dictionary's own prototype
 * instead of storing an entry. Either way one widget's answer becomes visible to
 * unrelated code, from nothing more than receiving a response. `constructor`
 * and `toString` misbehave for the same reason without the global damage.
 *
 * A null prototype makes every key data. `Object.keys`, `in` and index reads all
 * behave as they already did for ordinary ids, so nothing downstream changes.
 */
function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
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
 * What a request that FAILED was asked with, by the error it failed with: a failed request has
 * no answer to carry it, and without it a card whose settings change after its first request
 * failed could not tell that it now asks something else, so it stayed on the old failure.
 * Weakly held, so an error the cache lets go of takes its entry with it.
 */
const askedWithByError = new WeakMap<object, AskedWith>();

/** What a partition was asked with: each card's question. */
interface AskedWith {
  applied: Record<string, string>;
}

/** Files what the failed `partition` was asked with against the error it threw, then rethrows. */
function failedAsking(
  partition: readonly WidgetQueryRequest[],
  error: unknown
): never {
  if (typeof error === "object" && error !== null) {
    askedWithByError.set(error, { applied: appliedSent(partition) });
  }
  throw error;
}

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
  if (value === undefined || value === null) return MISSING_SLOT;
  if (!isObject(value)) return MALFORMED_SLOT;
  // 🔴 The SAME slot for the same cached answer, on every render. This hook
  // rebuilds its dictionaries each render, and a card keys its component's
  // draw on the slot it is handed: a new object reads as a new answer. Read
  // afresh each time, a component that threw was caught, re-rendered the grid
  // by reporting it, met a "new" answer and threw again until React stopped
  // it, and every component card remounted whenever the grid re-rendered. The
  // raw slot is the cache's own object, kept across renders and across the
  // copies a stream makes, so it is the key.
  const read = readSlots.get(value);
  if (read !== undefined) return read;
  const slot = readSlot(value);
  readSlots.set(value, slot);
  return slot;
}

/** Each raw slot the cache holds, as read once: see `asSlot`. */
const readSlots = new WeakMap<object, WidgetSlot>();

/** One raw slot read as a `WidgetSlot`, by the rules `asSlot` documents. */
function readSlot(value: Record<string, unknown>): WidgetSlot {
  const slot = value as {
    ok?: unknown;
    error?: unknown;
    code?: unknown;
    setting?: unknown;
    result?: unknown;
    empty?: unknown;
  };

  if (slot.ok === false) return refusal(slot.error, slot.code, slot.setting);
  if (slot.ok !== true) return malformed();

  const result = asResult(slot.result);
  if (result === undefined) return malformed();

  // The verdict of a declared widget's empty test, carried with the answer it
  // was made about. Read from this slot alone, so an answer that is no longer
  // empty arrives without it and the card leaves its empty state.
  return slot.empty === true
    ? { ok: true, result, empty: true }
    : { ok: true, result };
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
    const field = asResultField(raw);
    if (field === undefined) return undefined;
    described.push(field);
  }

  return described.length > 0 ? described : undefined;
}

/**
 * One field description, or `undefined` when it is not one.
 *
 * Shared by a list's columns and a grouped result's `field`, so both are read by one set of
 * rules.
 */
function asResultField(raw: unknown): WidgetResultField | undefined {
  if (!isObject(raw)) return undefined;
  const field = raw as {
    name?: unknown;
    label?: unknown;
    type?: unknown;
    choices?: unknown;
  };
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
  const choices = asChoices(field.choices);
  return {
    name: field.name,
    ...(field.label !== undefined && { label: field.label }),
    ...(type !== undefined && { type }),
    ...(choices !== undefined && { choices }),
  };
}

/**
 * A column's value labels, or `undefined`.
 *
 * DROPPED rather than refused when malformed, for the reason an unknown kind is: the labels are
 * presentation, and without them a cell shows the stored value, as it did before labels were
 * carried. A malformed entry costs the whole list, because a partial list would label some values
 * and print others raw in one column.
 */
function asChoices(
  value: unknown
): { value: string; label: string }[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const choices: { value: string; label: string }[] = [];
  for (const raw of value) {
    if (!isObject(raw)) return undefined;
    const { value: stored, label } = raw as {
      value?: unknown;
      label?: unknown;
    };
    // A blank label is malformed too: the cell or bar would show nothing where the value belongs,
    // which is why a source registering one is refused. A resolver's answer reaches here without
    // passing that check, so it is repeated at this boundary.
    if (
      typeof stored !== "string" ||
      typeof label !== "string" ||
      label.trim() === ""
    ) {
      return undefined;
    }
    choices.push({ value: stored, label });
  }
  return choices;
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

/**
 * The buckets of a grouped result, or `undefined` when the payload is not one.
 *
 * Every MEMBER is checked, not just the array, for the reason the list arm
 * checks its rows: a chart dereferences `count` per bucket and sorts on it, so
 * `[null]` or a bucket whose count is a string fails where it is drawn rather
 * than here, with nothing left to say why.
 *
 * A non-finite count is refused for the same reason a non-finite total is:
 * `1e400` is valid JSON, parses to `Infinity`, and renders as a lone infinity
 * sign in a bar that would otherwise dwarf every real bucket.
 *
 * A null `value` is KEPT. It is the bucket of rows whose column is empty --
 * "how many have no region" is a real answer, and dropping it would silently
 * remove rows from a chart that claims to account for all of them.
 *
 * A bucket's own `atLeast` is carried when it is `true`: it says that one
 * count is a floor, where the result's flag says only that some count is, so
 * a reader that drew from the result's flag alone would put "N+" on whole
 * counts beside it.
 */
function asBuckets(
  value: unknown
): { value: string | null; count: number; atLeast?: boolean }[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const buckets: { value: string | null; count: number; atLeast?: boolean }[] =
    [];
  for (const raw of value) {
    if (!isObject(raw)) return undefined;
    const bucket = raw as {
      value?: unknown;
      count?: unknown;
      atLeast?: unknown;
    };
    if (bucket.value !== null && typeof bucket.value !== "string") {
      return undefined;
    }
    if (typeof bucket.count !== "number" || !Number.isFinite(bucket.count)) {
      return undefined;
    }
    buckets.push({
      value: bucket.value,
      count: bucket.count,
      ...(bucket.atLeast === true ? { atLeast: true } : {}),
    });
  }
  return buckets;
}

/**
 * A grouped result, or `undefined` when the payload does not carry one.
 *
 * `truncated` is carried through rather than dropped, for the reason `atLeast`
 * is on a count: it says the bucket set is PARTIAL, and a chart that loses it
 * presents the categories it happens to hold as the whole picture. `atLeast` is
 * carried for its own reason: it says the counts inside the buckets are floors,
 * and a chart that loses it draws short counts as whole ones.
 */
function asGrouped(
  buckets: unknown,
  truncated: unknown,
  field: unknown,
  atLeast: unknown,
  asOf: unknown
): WidgetResult | undefined {
  const read = asBuckets(buckets);
  if (!read) return undefined;
  // The grouped field's label and value labels, for the chart's heading and bars. A malformed
  // one is dropped, like a column's: the buckets are the answer, the names are presentation.
  const described = field === undefined ? undefined : asResultField(field);
  return {
    op: "groupBy",
    buckets: read,
    ...(truncated === true ? { truncated: true } : {}),
    ...(described !== undefined && { field: described }),
    ...(atLeast === true ? { atLeast: true } : {}),
    // The instant the answer was computed at, kept only in the form the server
    // writes it, so a link built from it opens what was counted.
    ...(typeof asOf === "string" && isInstant(asOf) ? { asOf } : {}),
  };
}

/**
 * A timeline result, or `undefined` when the payload does not carry one.
 *
 * A ZERO count is kept exactly as a positive one is. Every interval in the
 * window was read, so zero means no rows rather than no answer, and dropping
 * the empty points would leave a chart drawing a straight line across a quiet
 * stretch -- reading as steady activity rather than none.
 *
 * `start` is checked as a string and the count as a finite number, for the
 * reason the buckets are: `NaN` and `Infinity` are both `typeof "number"` and
 * both reach a chart as a bar of no height or one that dwarfs every real point.
 */
/**
 * Whether text is a timestamp this can be read back as the instant it claims.
 *
 * `Date.parse` alone is too permissive for a contract check: it accepts a bare
 * "2026" and platform-specific spellings. Requiring the canonical form the
 * server emits means a response that drifted from the contract is caught here
 * rather than at the point something tries to draw it.
 */
function isInstant(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)) {
    return false;
  }
  const parsed = Date.parse(text);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === text;
}

function asPoints(
  value: unknown
): { start: string; count: number }[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const points: { start: string; count: number }[] = [];
  for (const raw of value) {
    if (!isObject(raw)) return undefined;
    const point = raw as { start?: unknown; count?: unknown };
    // `start` is contractually a UTC instant, and this decoder exists to keep a
    // malformed or version-skewed response away from the components that draw
    // it. Arbitrary text reaches a chart as an unlabelled axis tick, or throws
    // when a component formats it as a date -- turning one bad slot into a
    // rendering error for the whole dashboard.
    if (typeof point.start !== "string" || !isInstant(point.start)) {
      return undefined;
    }
    if (typeof point.count !== "number" || !Number.isFinite(point.count)) {
      return undefined;
    }
    points.push({ start: point.start, count: point.count });
  }
  return points;
}

/**
 * A timeline result, or `undefined` when the payload does not carry one.
 *
 * The interval is checked against the vocabulary rather than passed through: it
 * labels the axis, and a value outside the union would reach a chart as a width
 * nothing knows how to render.
 */
function asTimeline(
  points: unknown,
  interval: unknown
): WidgetResult | undefined {
  const read = asPoints(points);
  if (!read || !isTimeseriesInterval(interval)) return undefined;
  return { op: "timeseries", points: read, interval };
}

function asResult(value: unknown): WidgetResult | undefined {
  if (!isObject(value)) return undefined;

  const result = value as {
    op?: unknown;
    total?: unknown;
    atLeast?: unknown;
    totalByKind?: unknown;
    window?: unknown;
    items?: unknown;
    fields?: unknown;
    buckets?: unknown;
    truncated?: unknown;
    asOf?: unknown;
    field?: unknown;
    points?: unknown;
    interval?: unknown;
  };

  if (result.op === "count") return asCount(result.total, result.atLeast);

  if (result.op === "list") {
    return asList(result);
  }

  if (result.op === "groupBy") {
    return asGrouped(
      result.buckets,
      result.truncated,
      result.field,
      result.atLeast,
      result.asOf
    );
  }

  if (result.op === "timeseries") {
    return asTimeline(result.points, result.interval);
  }

  if (result.op === "data") return asData(result);

  return undefined;
}

/**
 * A list answer: the MEMBERS as well as the array, because a row is
 * dereferenced per field by whatever draws it, and `[null]` is an array that
 * fails there rather than here -- the same shape as a count's `total`, one
 * level down.
 */
function asList({
  items,
  fields,
  total,
  atLeast,
  totalByKind,
  window,
}: {
  items?: unknown;
  fields?: unknown;
  total?: unknown;
  atLeast?: unknown;
  totalByKind?: unknown;
  window?: unknown;
}): WidgetResult | undefined {
  if (!Array.isArray(items)) return undefined;
  const rows: unknown[] = items;
  if (!rows.every(isObject)) return undefined;
  const described = asResultFields(fields);
  // The list's whole count travels with its rows, so a card says the number the server counted
  // (a list's "View all (N)", the Content card's subtitle). Kept only as a count can be: a whole
  // number of at least zero; anything else is left out, and a card falls back to saying more
  // exist as a floor. How it divides by kind is kept by the same rule, each part a count, or
  // left out whole.
  const counted = isCount(total);
  const byKind = asCountsByKind(totalByKind);
  // The span a source's rows were read within (the Continue card's trail window), so a card's
  // empty text can name it; kept only as a whole number of days of at least one.
  const span = asWindow(window);
  return {
    op: "list",
    items: rows,
    ...(described && { fields: described }),
    ...(counted && { total }),
    ...(counted && atLeast === true && { atLeast: true }),
    ...(byKind && { totalByKind: byKind }),
    ...(span && { window: span }),
  };
}

/** A list's `window` when it is `{ days }` with a whole number of days of at least one. */
function asWindow(value: unknown): { days: number } | undefined {
  if (!isObject(value)) return undefined;
  const { days } = value as { days?: unknown };
  return typeof days === "number" && Number.isInteger(days) && days >= 1
    ? { days }
    : undefined;
}

/** Whether `value` is a count: a whole number of at least zero. */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * A list's `totalByKind` when it is a plain object of counts ({@link isCount}), each kind to
 * its count; `undefined` for anything else, a single part that is not a count included, so a
 * card never draws a part of a breakdown the server did not send. The rule core's display
 * schema checks a declared widget's answer by (`LIST_DATA` in nextly's
 * `domains/widgets/declaration/displays.ts`).
 */
function asCountsByKind(
  value: unknown
): Readonly<Record<string, number>> | undefined {
  if (!isObject(value) || Array.isArray(value)) return undefined;
  const counts: [string, number][] = [];
  for (const [kind, count] of Object.entries(value)) {
    if (!isCount(count)) return undefined;
    counts.push([kind, count]);
  }
  // `fromEntries` defines each kind as the object's own data, a `__proto__` kind included.
  return Object.fromEntries(counts);
}

/**
 * A declared widget's own data, for the component it draws itself with. Any
 * value JSON carries is one: the server held it to the transport rule before
 * it was sent, and the component is what reads its shape.
 */
function asData(result: object): WidgetResult | undefined {
  if (!("data" in result)) return undefined;
  // JSON.parse answers only JSON values, and every JSON value is data a
  // component may be handed, so the parsed value is that type as it is.
  return {
    op: "data",
    data: result.data as Extract<WidgetResult, { op: "data" }>["data"],
  };
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

/**
 * The answers no raw slot carries, one object each, so a card handed one keeps
 * the same answer across renders as `asSlot` keeps every other.
 */
const MISSING_SLOT: WidgetSlot = Object.freeze({
  ok: false,
  error: MISSING_SLOT_ERROR,
});
const MALFORMED_SLOT: WidgetSlot = Object.freeze({
  ok: false,
  error: MALFORMED_SLOT_ERROR,
});
const BATCH_FAILED_SLOT: WidgetSlot = Object.freeze({
  ok: false,
  error: BATCH_FAILED_ERROR,
});

/** The refusal a member gets when it is not a slot at all. */
function malformed(): WidgetSlot {
  return MALFORMED_SLOT;
}

/**
 * A declared failure, carrying the server's own message.
 *
 * A slot that says `ok: false` and supplies no readable message is still a
 * failure -- refusing to show it would be a second, silent one -- so it falls
 * back rather than being discarded.
 */
function refusal(
  error: unknown,
  code?: unknown,
  setting?: unknown
): WidgetSlot {
  const usable = typeof error === "string" && error.trim() !== "";
  if (!usable) return { ok: false, error: MALFORMED_SLOT_ERROR };
  // The codes the server sends for a card that is not a failure, each kept so the card says so
  // rather than offering Retry for something a retry will not change: a source not available to
  // the reader, a setting the card needs and lacks (naming it), and a widget not shown for them.
  // Only on a well-formed refusal: a slot missing its message is a broken answer that may
  // recover, and a code would hide that behind a state that removes Retry. So is a needs-setting
  // that names no setting, which is read as the failure it then is.
  if (code === "unavailable" || code === "not-shown") {
    return { ok: false, error, code };
  }
  if (
    code === "needs-setting" &&
    typeof setting === "string" &&
    setting.trim() !== ""
  ) {
    return { ok: false, error, code, setting };
  }
  return { ok: false, error };
}

/** One partition's answer as the cache holds it, filled in slot by slot while it streams. */
interface PartitionAnswer {
  /** Each request's slot by position, unread; `undefined` for one not yet arrived. */
  slots: unknown[];
  /**
   * Which slots arrived in the CURRENT request, while it streams. A refetch keeps the slots
   * already held on screen while it runs, so a held slot is not proof that its card has its new
   * answer; this is. Read only while `complete` is false: a complete answer is a whole earlier
   * request's, and every card in it is waiting again once the next request starts.
   */
  settled: boolean[];
  /** Whether the answer has ended. Until it has, a slot not yet arrived is on its way, not lost. */
  complete: boolean;
  /** What each card's answer was asked with (`appliedKey`), by placement. */
  applied: Record<string, string>;
}

/**
 * Asks one partition, filing each slot into the cache as it arrives, so its card draws without
 * waiting for any card a slower source answers.
 *
 * Merged by position over the answer already held: a refetch keeps the old numbers on screen
 * until each card's new one arrives. Every write before the end keeps the held answer's time, so
 * the dashboard's freshness line moves once the answer is whole, never on its first slot.
 */
async function askPartition(
  partition: readonly WidgetQueryRequest[],
  queryClient: QueryClient,
  ask: { queryKey: QueryKey; signal: AbortSignal; readAheadToken?: string }
): Promise<PartitionAnswer> {
  const { queryKey, signal, readAheadToken } = ask;
  const applied = appliedSent(partition);
  const held = queryClient.getQueryData<PartitionAnswer>(queryKey);
  const heldAt = queryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0;
  const slots: unknown[] = partition.map(
    (_, position) => held?.slots[position]
  );
  const settled: boolean[] = partition.map(() => false);
  // What each shown slot was asked with, while some are still the held answer's: an arrived slot
  // was asked with this request's size and settings, one not yet arrived with the held answer's.
  // Recorded as the request's for all, a card left showing its old answer by a broken stream
  // would read as already asked with its new settings, and never ask again.
  const askedSoFar = (): Record<string, string> => {
    const record = emptyRecord<string>();
    if (held?.applied) Object.assign(record, held.applied);
    partition.forEach((entry, position) => {
      const asked = Object.hasOwn(applied, entry.placementId)
        ? applied[entry.placementId]
        : undefined;
      if (settled[position] && asked !== undefined) {
        record[entry.placementId] = asked;
      }
    });
    return record;
  };
  const write = () =>
    queryClient.setQueryData<PartitionAnswer>(
      queryKey,
      {
        slots: [...slots],
        settled: [...settled],
        complete: false,
        applied: askedSoFar(),
      },
      { updatedAt: heldAt }
    );

  const answered = await fetchWidgetBatch(partition.map(sentEntry), {
    signal,
    // The token of the layout answer the dashboard is drawn from, the one this request's key
    // carries: the server hands a card the answer that read worked out ahead under it, once, so
    // this load is never handed another tab's.
    ...(readAheadToken === undefined ? {} : { readAheadToken }),
    onSlots: arrived => {
      for (const { index, slot } of arrived) {
        if (index >= partition.length) continue;
        slots[index] = slot;
        settled[index] = true;
      }
      write();
    },
  });
  // Whole: a slot the answer never carried is missing now, whatever was held for it before.
  return {
    slots: partition.map((_, position) => answered[position]),
    settled: partition.map(() => true),
    complete: true,
    applied,
  };
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

/** The key of one partition's answer, before the load it is asked for. */
function partitionKey(
  partition: readonly WidgetQueryRequest[]
): readonly unknown[] {
  return [...WIDGET_QUERIES_KEY, partition.map(keyedAs)];
}

/**
 * The latest answer held for the same partition under another load's token (or none), with when
 * it was written: what a partition asked under a new token starts from, so its cards keep the
 * numbers on screen while the new load's request runs, as a refetch keeps them under one key.
 * Matched by the whole partition key, not by prefix: TanStack's partial match would take a
 * partition that merely begins with this one's requests.
 */
function heldUnderAnotherLoad(
  queryClient: QueryClient,
  partition: readonly WidgetQueryRequest[]
): { data: PartitionAnswer; at: number } | undefined {
  const own = hashKey(partitionKey(partition));
  let held: { data: PartitionAnswer; at: number } | undefined;
  const entries = queryClient.getQueriesData<PartitionAnswer>({
    queryKey: ["dashboard", "widget-queries"],
  });
  for (const [key, data] of entries) {
    if (data === undefined || hashKey(key.slice(0, 3)) !== own) continue;
    const at = queryClient.getQueryState(key)?.dataUpdatedAt ?? 0;
    if (held === undefined || at > held.at) held = { data, at };
  }
  return held;
}

/**
 * Batches `queries` into as few requests as the endpoint allows and hands each
 * widget back its own slot.
 *
 * `readAheadToken` is the token of the layout answer the dashboard is drawn
 * from, absent where there is none (or the batch is not a dashboard's own). It
 * is part of each partition's key, so a layout answer with a new token asks the
 * whole batch again, once, under that token, and the server can hand a card the
 * answer that layout read worked out ahead for it; the same token asks nothing.
 */
export function useWidgetQueries(
  queries: WidgetQueryRequest[],
  readAheadToken?: string
): UseWidgetQueriesResult {
  const partitions = useMemo(() => partitionRequests(queries), [queries]);
  const queryClient = useQueryClient();

  const results = useQueries({
    queries: partitions.map(partition => ({
      // The partition's own requests are its key, WITHOUT their size or stored settings. Two
      // dashboards asking for different cards are different questions and must not share one
      // cache entry; TanStack hashes the array deterministically, so a re-render with an
      // equal-but-new array does not refetch. The size is left out so a change of tier is not a
      // new question; see `WidgetQueryRequest.cardSize`. Then the layout answer's token, when
      // there is one: a new layout answer is a new load, whose cards the server may hand what it
      // read ahead for it, so the batch is asked again under it, and a request that started under
      // the token held before is not the one its cards are drawn from.
      queryKey: [
        ...partitionKey(partition),
        ...(readAheadToken === undefined ? [] : [readAheadToken]),
      ],
      // Built from this render's partition, and TanStack runs the latest observer's function,
      // so a refetch sends each card's CURRENT size. The signal is TanStack's own, so a
      // dashboard the reader leaves stops reading, and the server gives up the batch.
      queryFn: async ({
        queryKey,
        signal,
      }: {
        queryKey: QueryKey;
        signal: AbortSignal;
      }): Promise<PartitionAnswer> => {
        try {
          return await askPartition(partition, queryClient, {
            queryKey,
            signal,
            ...(readAheadToken === undefined ? {} : { readAheadToken }),
          });
        } catch (error) {
          return failedAsking(partition, error);
        }
      },
      // Under a new token, the answer the partition held under the one before, with its time, so
      // the cards keep their numbers and the freshness line while the new load is asked. Read
      // when the new entry is made; never under the same token, which has its own answer.
      initialData: () => heldUnderAnotherLoad(queryClient, partition)?.data,
      initialDataUpdatedAt: () =>
        heldUnderAnotherLoad(queryClient, partition)?.at,
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
  // Keyed by caller-supplied ids; see `emptyRecord`.
  const slots: Record<string, WidgetSlot> = emptyRecord();
  // What each answer was asked with, read from the cached answer itself: the request that wrote
  // it may belong to a render that has since left, and the answer a returning card receives is
  // that request's, asked with that request's size and settings.
  const fetchedApplied: Record<string, string> = emptyRecord();
  partitions.forEach((partition, index) => {
    const answer = results[index];
    if (!answer) return;

    if (answer.data) {
      const data = answer.data;
      // Still streaming: a slot not yet here is on its way, so its card stays busy rather than
      // being told it is missing. Once the request has ended, by finishing or by failing, it is
      // not on its way any more.
      const streaming = !data.complete && answer.isFetching;
      partition.forEach((entry, position) => {
        const slot = data.slots[position];
        if (slot === undefined && streaming) return;
        // A short response is the server disagreeing with us about how many
        // questions were asked, and a member that is not a slot is it
        // disagreeing about the shape. Saying so per widget is what stops the
        // trailing cards spinning silently forever -- and what keeps one bad
        // entry from throwing out of the renderer and taking the page with it.
        // A slot a failed stream never delivered says the request failed.
        slots[entry.placementId] =
          slot === undefined && answer.isError
            ? BATCH_FAILED_SLOT
            : asSlot(slot);
      });
      Object.assign(fetchedApplied, answer.data.applied);
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
        slots[entry.placementId] = BATCH_FAILED_SLOT;
      });
      // A settled failure was asked with something too, which a change of settings is judged
      // against; a first request still in flight has neither, and its answer will say.
      const asked =
        typeof answer.error === "object" && answer.error !== null
          ? askedWithByError.get(answer.error)
          : undefined;
      if (asked) Object.assign(fetchedApplied, asked.applied);
    }
  });

  /*
   * 🔴 Per PARTITION, not per batch. A dashboard above `MAX_QUERIES_PER_REQUEST`
   * is split into independently settling requests, and the failure branch above
   * already treats them independently -- "only this partition's widgets are
   * affected, which is the point of splitting them". Reducing the fetch state
   * with `some` threw that away for the one signal a card renders: a widget
   * whose own partition answered went on reporting itself busy, dimming settled
   * numbers, until every OTHER partition had answered too. A card's frame reads
   * its own fetch state as this card's question, so this is what makes that
   * true rather than nearly true.
   */
  const fetchingPlacementIds = new Set<string>();
  partitions.forEach((partition, index) => {
    const answer = results[index];
    if (answer?.isFetching !== true) return;
    // Per CARD within the partition, too: a card whose slot this request already delivered has
    // its answer, even while a slower card in the same request is still on its way. Only once
    // this request has written: until then the cached answer is the previous request's whole one,
    // and every card in it is being asked again.
    const streaming = answer.data !== undefined && !answer.data.complete;
    partition.forEach((entry, position) => {
      if (streaming && answer.data?.settled[position] === true) return;
      fetchingPlacementIds.add(entry.placementId);
    });
  });

  const settledAt = results.map(answer => answer.dataUpdatedAt);
  const answeredAtFor = usePartitionAnswerTimes(partitions, settledAt);

  // Stable while what the answers were asked with is, so a caller keyed on it does not run again
  // on every render.
  const appliedKeyOfAll = JSON.stringify(fetchedApplied);
  const fetchedAppliedFor = useMemo(() => {
    const applied = JSON.parse(appliedKeyOfAll) as Record<string, string>;
    return (placementId: string): string | undefined =>
      Object.hasOwn(applied, placementId) ? applied[placementId] : undefined;
  }, [appliedKeyOfAll]);

  return {
    slots,
    isLoading: results.some(answer => answer.isLoading),
    /*
     * 🔴 DERIVED from the set, not reduced a second time from the same results.
     * The two answer one question -- "is anything still loading" -- and
     * computing it twice is how they come to disagree: a later change to which
     * partitions count as in flight would have to be made in both places, and
     * the grid-wide affordance and the per-card one would drift apart silently.
     *
     * So the grid is busy exactly while some CARD is still waiting for its
     * answer. A request whose every slot has arrived, and which is only closing
     * its stream, keeps nobody waiting and makes nothing busy.
     */
    isFetching: fetchingPlacementIds.size > 0,
    fetchingPlacementIds,
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
    answeredAtFor,
    fetchedAppliedFor,
  };
}

/**
 * Each card's own request's answer time (`UseWidgetQueriesResult.answeredAtFor`), from the
 * partitions and each one's `dataUpdatedAt`, which is 0 until it has answered once. Stable while
 * those times and the cards in each partition are, so a caller keyed on it does not run again on
 * every render.
 */
function usePartitionAnswerTimes(
  partitions: readonly (readonly WidgetQueryRequest[])[],
  settledAt: readonly number[]
): (placementId: string) => Date | null {
  const timesKey = JSON.stringify(
    partitions.flatMap((partition, index) =>
      partition.map(entry => [entry.placementId, settledAt[index] ?? 0])
    )
  );
  return useMemo(() => {
    const times = new Map(JSON.parse(timesKey) as [string, number][]);
    return (placementId: string): Date | null => {
      const at = times.get(placementId) ?? 0;
      return at > 0 ? new Date(at) : null;
    };
  }, [timesKey]);
}

/** What each request in `partition` was asked with, by placement: cached with the answer. */
function appliedSent(
  partition: readonly WidgetQueryRequest[]
): Record<string, string> {
  const applied: Record<string, string> = emptyRecord();
  for (const entry of partition) {
    applied[entry.placementId] = appliedKey(entry);
  }
  return applied;
}

/**
 * A request as the cache keys it: everything but the size (`cardSize`) and the stored settings it
 * is filed under (`config`), which a card's own re-ask follows instead (`useCardRetries`).
 * Named field by field, so a field added to the request is a decision about the key rather than
 * an accident.
 */
function keyedAs(
  request: WidgetQueryRequest
): Omit<WidgetQueryRequest, "cardSize" | "config"> {
  return {
    placementId: request.placementId,
    card: request.card,
    attempt: request.attempt,
  };
}
