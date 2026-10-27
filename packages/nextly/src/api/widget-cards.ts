/**
 * The by-card half of the dashboard batch: a declared widget's card, asked for
 * by widget and card id, answered on the server from its declaration.
 *
 * A declared widget's data is never a query the browser holds: it is a data
 * function core runs, or a query core writes from the card's settings. So the
 * browser asks for the CARD, and core looks it up in what this caller was
 * handed, builds what it needs, and runs it as the person asking.
 *
 * @module api/widget-cards
 */
import { z } from "zod";

import type { AuthContext } from "../auth/middleware";
import { answerAsAsked } from "../domains/widgets/answer-as-asked";
import { cardAnswerResult } from "../domains/widgets/declaration/card-answer";
import { resolveCardSettings } from "../domains/widgets/declaration/card-query";
import {
  checkedCardQuery,
  declaredWidget,
  type DeclaredWidget,
} from "../domains/widgets/declaration/declared-widgets";
import { bindReadServices } from "../domains/widgets/declaration/read-services";
import { executeWidgetQuery } from "../domains/widgets/execute";
import { GRID_COLUMNS, MIN_GRID_ROWS } from "../domains/widgets/grid-size";
import type { WidgetPlacement } from "../domains/widgets/layout";
import type { WidgetQuery } from "../domains/widgets/query";
import type { WidgetResult, WidgetSlot } from "../domains/widgets/result";
import { failUnavailableSourceOrOp } from "../domains/widgets/sources";
import type { ReadCaller } from "../services/dashboard/readable-resources";

import { askableCards } from "./widget-layout";
import { failedSlot, type ReadyCardData } from "./widget-slots";

/**
 * A by-card entry: which card, of which widget, and nothing more.
 *
 * 🔴 Strict, so an entry naming a widget carries no query, source or op beside
 * it: a mixed entry is refused with the one "unavailable" answer. That is what
 * keeps a declared widget's data out of the browser's reach: what only a data
 * function computes can be asked for by card alone, and nothing outside the
 * runner can name the function, since no source, query or op stands for it.
 */
const CARD_ENTRY = z.strictObject({
  widget: z.string().min(1),
  card: z.string().min(1),
});

/**
 * A card that is not a stored one: a card of a widget the caller could place,
 * asked with settings of their choosing -- one added while customising and not
 * yet saved, or the settings sheet's preview of a change. As strict as a card.
 *
 * 🔴 Answered only for a widget the caller could place (the layout write's own
 * gate), so running it with chosen settings is exactly what placing a card of
 * it and choosing them would do. The settings are resolved as a stored card's
 * are, so an undeclared key is dropped and a value that does not fit falls back.
 */
const PREVIEW_ENTRY = z.strictObject({
  widget: z.string().min(1),
  settings: z.record(z.string(), z.unknown()),
});

/** What a batch's cards may be looked up in: what the caller was handed, and could place. */
type AskableCards = Awaited<ReturnType<typeof askableCards>>;

/** Whether a batch entry asks for a card rather than carrying a query. */
export function isCardEntry(raw: unknown): boolean {
  return (
    typeof raw === "object" && raw !== null && Object.hasOwn(raw, "widget")
  );
}

/** What preparing a batch's cards needs from the batch. */
export interface CardBatch {
  auth: AuthContext;
  caller: ReadCaller;
  /**
   * A query checked as the batch checks its own: the caller may read its
   * source, and the query is valid for it. Throws the refusal a query gets.
   */
  check: (raw: unknown) => Promise<WidgetQuery>;
}

/**
 * The one answer every card that cannot be answered gets: an unknown card, a
 * card of a widget this caller may not see, a card whose widget is gone or was
 * never declared, and a mixed entry. One slot, built by the refusal the batch
 * gives an unavailable source, so the bytes cannot tell any of them apart.
 */
function unavailableCard(detail: string): WidgetSlot {
  try {
    failUnavailableSourceOrOp(detail);
  } catch (error) {
    return failedSlot(error);
  }
}

/**
 * Each by-card entry of a batch, at its index: ready to run, or refused.
 *
 * The caller's cards are read once, and only when the batch asks for one.
 */
export async function prepareCards(
  entries: readonly unknown[],
  batch: CardBatch
): Promise<Map<number, ReadyCardData | WidgetSlot>> {
  const prepared = new Map<number, ReadyCardData | WidgetSlot>();
  const asked = entries.flatMap((raw, index) =>
    isCardEntry(raw) ? [{ raw, index }] : []
  );
  if (asked.length === 0) return prepared;
  const cards = await askableCards(batch.auth);
  for (const { raw, index } of asked) {
    prepared.set(index, cardEntryFor(raw, index, cards, batch));
  }
  return prepared;
}

/**
 * The card an entry asks for, looked up in what the caller may ask, or why it
 * cannot be (for the log only: every one answers the same).
 */
function askedPlacement(
  raw: unknown,
  cards: AskableCards
): WidgetPlacement | string {
  const stored = CARD_ENTRY.safeParse(raw);
  if (stored.success) {
    const { widget, card } = stored.data;
    const placement = cards.handed.get(card);
    return placement !== undefined && placement.widgetId === widget
      ? placement
      : `card "${card}" of widget "${widget}" is not one this caller was handed`;
  }
  const preview = PREVIEW_ENTRY.safeParse(raw);
  if (preview.success) {
    const { widget, settings } = preview.data;
    // Not a stored card, so it has no id of its own; its config is the
    // settings asked with, read exactly as a stored card's is. Its size
    // answers nothing about its data, so it is the full width at the fewest
    // rows a card may span.
    return cards.placeable.has(widget)
      ? {
          id: "preview",
          widgetId: widget,
          w: GRID_COLUMNS,
          h: MIN_GRID_ROWS,
          removed: false,
          config: settings,
        }
      : `widget "${widget}" is not one this caller could place`;
  }
  return "an entry not of the form { widget, card } or { widget, settings }";
}

/** One by-card entry, looked up in the caller's cards. */
function cardEntryFor(
  raw: unknown,
  index: number,
  cards: AskableCards,
  batch: CardBatch
): ReadyCardData | WidgetSlot {
  const placement = askedPlacement(raw, cards);
  if (typeof placement === "string") return unavailableCard(placement);
  const widget = placement.widgetId;
  const declared = declaredWidget(widget);
  if (declared === undefined) {
    return unavailableCard(`widget "${widget}" is no longer declared`);
  }
  return {
    kind: "data",
    index,
    widgetId: widget,
    owner: declared.owner,
    answer: asked => answerCard(declared, placement, batch, asked),
  };
}

/**
 * One card's answer, as the person asking: its data function run with its
 * settings and person-bound services, or the query its settings write, checked
 * and run as the batch's own. Then its empty test, in the same slot, when the
 * declaration states one; otherwise the display's own rule decides in the admin.
 */
async function answerCard(
  declared: DeclaredWidget,
  placement: WidgetPlacement,
  batch: CardBatch,
  asked: Parameters<ReadyCardData["answer"]>[0]
): Promise<{ result: WidgetResult; empty: boolean }> {
  const { signal, scope, now } = asked;
  const { declaration, collections } = declared;
  const { isEmpty } = declaration;
  if (typeof declaration.load === "function") {
    const run = declaration.load as (input: unknown) => Promise<unknown>;
    const value = await run({
      settings: resolveCardSettings(declaration.settings, placement.config),
      user: batch.caller.user,
      signal,
      scope,
      now,
      services: bindReadServices({
        caller: batch.caller,
        prepare: batch.check,
        signal,
        now,
        ...(collections === undefined ? {} : { collections }),
      }),
    });
    const result = cardAnswerResult(declared.display, value, declaration.id);
    return { result, empty: isEmpty?.(value) === true };
  }
  // Through the one checked builder: a query its display cannot draw fails
  // this card alone, rather than reaching the admin as an answer it misreads.
  const built = checkedCardQuery(declared, placement.config);
  // A query that cannot be written (a setting it needs has no value) is a card
  // with nothing it may be asked: the one unavailable answer, like any other.
  if (built === undefined) {
    failUnavailableSourceOrOp(
      `card "${placement.id}" of widget "${declaration.id}" has no query to run`
    );
  }
  const query = await batch.check(built);
  const result = answerAsAsked(
    query,
    await executeWidgetQuery(query, batch.caller, {
      signal,
      scope,
      now: new Date(now),
    })
  );
  return { result, empty: isEmpty?.(result) === true };
}
