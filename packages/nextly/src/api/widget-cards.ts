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
import { cardAnswerResult } from "../domains/widgets/declaration/card-answer";
import {
  renamedCollection,
  resolveCardSettings,
  unsetSetting,
} from "../domains/widgets/declaration/card-settings";
import {
  declaredWidget,
  type DeclaredWidget,
} from "../domains/widgets/declaration/declared-widgets";
import { bindReadServices } from "../domains/widgets/declaration/read-services";
import { GRID_COLUMNS, MIN_GRID_ROWS } from "../domains/widgets/grid-size";
import type { WidgetPlacement } from "../domains/widgets/layout";
import type { WidgetQuery } from "../domains/widgets/query";
import type { WidgetSlot } from "../domains/widgets/result";
import { failUnavailableSourceOrOp } from "../domains/widgets/sources";
import { NextlyError } from "../errors/nextly-error";
import { getNextlyLogger } from "../observability/logger";
import type { ReadCaller } from "../services/dashboard/readable-resources";

import { askableCards } from "./widget-layout";
import {
  failedSlot,
  type CardAnswer,
  type ReadyCardData,
} from "./widget-slots";

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
// Narrowed to the failure arm, so a card refused before its load can be settled with it.
function unavailableCard(detail: string): Extract<WidgetSlot, { ok: false }> {
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

/** What a card's settings, person and budget hand its widget's own functions. */
type CardInput = Parameters<ReadyCardData["answer"]>[0];

/**
 * Whether this person fails the widget's `access`, judged with them before
 * `load` runs: a permission name was judged already, when the card was handed
 * (`askableCards`); the collections it reads, through the batch's own check,
 * the one gate every collection read passes; a predicate, with the person.
 *
 * 🔴 A predicate that throws refuses: it is the plugin's own code deciding who
 * may see data, and a decision that could not be made is no. It runs within
 * the card's budget, as `load` does, so one that never settles fails its card
 * alone.
 */
async function refusedAccess(
  declared: DeclaredWidget,
  batch: CardBatch
): Promise<boolean> {
  const { access } = declared.declaration;
  if (typeof access === "function") {
    try {
      return (await access({ user: batch.caller.user })) !== true;
    } catch (error) {
      logPluginFailure(declared, "widget-access-threw", error);
      return true;
    }
  }
  if (typeof access === "object" && access !== null) {
    for (const collection of access.collections) {
      try {
        await batch.check({
          source: `collection:${renamedCollection(collection, declared.collections)}`,
          op: "count",
        });
      } catch {
        return true;
      }
    }
  }
  return false;
}

/**
 * The refusal a declared widget's own code failing becomes, naming the owner,
 * the widget and the reason for the operator, and nothing the code said.
 *
 * 🔴 No cause in production: a plugin's error can carry the data it was
 * reading, and the log is no place for it. In development the plugin's own
 * message and stack are logged too, so an author can see why their widget
 * failed.
 */
function pluginFailure(
  declared: DeclaredWidget,
  reason: string,
  error: unknown
): NextlyError {
  return new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: "An unexpected error occurred.",
    logMessage: `Declared widget "${declared.declaration.id}" of ${declared.owner} failed: ${reason}`,
    logContext: {
      owner: declared.owner,
      widget: declared.declaration.id,
      reason,
      ...authorsOwnError(error),
    },
  });
}

/** The plugin's own error, for the log in development only. */
function authorsOwnError(error: unknown): { pluginError?: unknown } {
  if (process.env.NODE_ENV === "production") return {};
  return {
    pluginError:
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : String(error),
  };
}

/** Logs a failure of a widget's own code that refuses rather than fails the card. */
function logPluginFailure(
  declared: DeclaredWidget,
  reason: string,
  error: unknown
): void {
  // Guarded as `failedSlot` guards its own: a log that throws must not fail the card.
  try {
    getNextlyLogger().warn({
      kind: "declared-widget-refused",
      ...pluginFailure(declared, reason, error).toLogJSON("declared-widget"),
    });
  } catch {
    // Deliberately swallowed; see above.
  }
}

/** Runs one of a widget's own functions, turning what it throws into `pluginFailure`. */
async function ownCode<T>(
  declared: DeclaredWidget,
  reason: string,
  run: () => T | Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    // Its own abort (the card's budget, or the batch given up) is not the plugin's fault,
    // and the budget names the card's timeout itself.
    if (NextlyError.is(error)) throw error;
    throw pluginFailure(declared, reason, error);
  }
}

/**
 * One card's answer, as the person asking, decided in this order, each before
 * the widget's own `load` runs:
 *
 * 1. Its `access`: a person it refuses gets the one "not available" answer.
 * 2. Its settings: one with no value asks the reader for it (`needs-setting`).
 * 3. Its `shows`: no leaves the card out for this person (`not-shown`).
 * 4. Its `load`, with its settings, the person, read services bound to them,
 *    the card's signal, the batch's instant and the owner's share scope. What
 *    it throws, and an answer JSON cannot carry, fails this card alone.
 *
 * Then its `isEmpty`, in the same slot, when the declaration states one.
 */
async function answerCard(
  declared: DeclaredWidget,
  placement: WidgetPlacement,
  batch: CardBatch,
  asked: CardInput
): Promise<CardAnswer> {
  if (await refusedAccess(declared, batch)) {
    return {
      settled: unavailableCard(
        `widget "${declared.declaration.id}" refused this person by its access`
      ),
    };
  }
  const { declaration, collections } = declared;
  const settings = resolveCardSettings(declaration.settings, placement.config);
  const missing = unsetSetting(declaration.settings, settings);
  if (missing !== undefined) {
    return {
      settled: {
        ok: false,
        error: `Choose ${missing.label} in the card's settings`,
        code: "needs-setting",
        setting: missing.label,
      },
    };
  }
  const { signal, scope, now } = asked;
  const input = {
    settings,
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
  };
  const { shows, load, isEmpty } = declaration;
  if (shows !== undefined) {
    const shown = await ownCode(declared, "widget-shows-threw", () =>
      shows(input)
    );
    if (shown !== true) {
      return {
        settled: { ok: false, error: "Not shown for you", code: "not-shown" },
      };
    }
  }
  const value = await ownCode(declared, "widget-load-threw", () => load(input));
  const result = cardAnswerResult(declared.display, value, {
    widget: declaration.id,
    owner: declared.owner,
  });
  return { result, empty: isEmpty?.(value) === true };
}
