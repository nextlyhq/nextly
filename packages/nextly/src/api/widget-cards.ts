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
  SLOT_TIMEOUT_MS,
  unavailableSlot,
  withinSlotBudget,
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
    // 🔴 Whatever it throws is the plugin's, a NextlyError included: one imported from the SDK
    // carries the plugin's own public message and log context, which can hold the data it was
    // reading. Core's own errors never pass through here: the card's budget and a batch given up
    // are decided around this call, and settle the card before anything thrown in here is read.
    throw pluginFailure(declared, reason, error);
  }
}

/** That a widget's access refused the person asking, for whoever is debugging it. */
function logRefusedAccess(declared: DeclaredWidget): void {
  // Guarded as `failedSlot` guards its own: a log that throws must not fail the card.
  try {
    getNextlyLogger().debug({
      kind: "declared-widget-access-refused",
      owner: declared.owner,
      widget: declared.declaration.id,
    });
  } catch {
    // Deliberately swallowed; see above.
  }
}

/** What a declared card's data function is handed, once its card has been judged shown. */
type LoadInput = Parameters<DeclaredWidget["declaration"]["load"]>[0];

/**
 * What a card's own rules decide for the person asking, in this order, each before the widget's
 * own `load` runs:
 *
 * 1. Its `access`: a person it refuses is `refused`.
 * 2. Its settings: one the widget needs with no value is `needs-setting`, naming it.
 * 3. Its `shows`: anything but `true` is `not-shown`.
 *
 * Otherwise it is `shown`, with what `load` would be handed: its settings, the person, read
 * services bound to them, the card's signal, the batch's instant and the owner's share scope.
 *
 * 🔴 The one judgement: a card answered (`answerCard`) and a card asked whether it is shown at all
 * (`cardIsShownTo`) both read it, so the two cannot come to answer one card differently.
 */
type CardVerdict =
  | { kind: "refused" }
  | { kind: "needs-setting"; label: string }
  | { kind: "not-shown" }
  | { kind: "shown"; input: LoadInput };

/**
 * Which of a card's rules is being judged, kept up to date by `judgeCard` for whoever bounds it:
 * a timeout names the stage that was running, the widget's access (its predicate, or core's own
 * check of the collections it reads) or its `shows`.
 */
type JudgingStage = { at: "access" | "shows" };

async function judgeCard(
  declared: DeclaredWidget,
  placement: WidgetPlacement,
  batch: CardBatch,
  asked: CardInput,
  stage: JudgingStage = { at: "access" }
): Promise<CardVerdict> {
  stage.at = "access";
  if (await refusedAccess(declared, batch)) return { kind: "refused" };
  const { declaration, collections } = declared;
  const settings = resolveCardSettings(declaration.settings, placement.config);
  const missing = unsetSetting(declaration.settings, settings);
  if (missing !== undefined) {
    return { kind: "needs-setting", label: missing.label };
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
  const { shows } = declaration;
  if (shows !== undefined) {
    stage.at = "shows";
    const shown = await ownCode(declared, "widget-shows-threw", () =>
      shows(input)
    );
    if (shown !== true) return { kind: "not-shown" };
  }
  return { kind: "shown", input };
}

/**
 * One card's answer, as the person asking: what its rules decide (`judgeCard`), then its `load`
 * for a card shown, whose throw, and whose answer JSON cannot carry, fails this card alone. Then
 * its `isEmpty`, in the same slot, when the declaration states one.
 */
async function answerCard(
  declared: DeclaredWidget,
  placement: WidgetPlacement,
  batch: CardBatch,
  asked: CardInput
): Promise<CardAnswer> {
  const verdict = await judgeCard(declared, placement, batch, asked);
  switch (verdict.kind) {
    case "refused":
      // Routine, not a failure: a person without access is answered "not available" on every
      // load, so it is said at debug level, not as an error (a predicate that threw has warned).
      logRefusedAccess(declared);
      return { settled: unavailableSlot() };
    case "needs-setting":
      return {
        settled: {
          ok: false,
          error: `No ${verdict.label} chosen yet`,
          code: "needs-setting",
          setting: verdict.label,
        },
      };
    case "not-shown":
      return {
        settled: { ok: false, error: "Not shown for you", code: "not-shown" },
      };
    case "shown":
      break;
  }
  const { declaration } = declared;
  const value = await ownCode(declared, "widget-load-threw", () =>
    declaration.load(verdict.input)
  );
  const result = cardAnswerResult(declared.display, value, {
    widget: declaration.id,
    owner: declared.owner,
  });
  return { result, empty: declaration.isEmpty?.(value) === true };
}

/**
 * Whether this person is shown this card at all, by the card's own rules (`judgeCard`), without
 * running its `load`: for a dashboard built for them, such as the default they follow, which
 * leaves out the cards they would not be shown.
 *
 * - Refused by its `access`: no.
 * - A setting it needs has no value: YES. The card asks for that setting itself ("No ...
 *   chosen yet", with a button to choose it), and leaving it out would hide the one step that
 *   fixes it.
 * - Its `shows`, as the person: only `true` is yes.
 * - No `shows`: yes.
 *
 * Judged within the card's own budget, under `signal` as the batch's: a `shows` that throws, or
 * that does not settle in time, is no, and is logged as the widget's failure. A permission name as
 * `access` is the caller's to have judged already, as the layout's audience does for every card it
 * hands over (`askableCards`).
 *
 * @param asked the signal the work is given up on, the instant reads measure from, and the
 * owner's share scope, as a card answered in the batch is handed them.
 */
export async function cardIsShownTo(
  declared: DeclaredWidget,
  placement: WidgetPlacement,
  batch: CardBatch,
  asked: CardInput
): Promise<boolean> {
  const stage: JudgingStage = { at: "access" };
  try {
    const verdict = await withinSlotBudget(
      signal =>
        judgeCard(declared, placement, batch, { ...asked, signal }, stage),
      () => judgingTimedOut(declared, stage),
      asked.signal
    );
    return verdict.kind === "shown" || verdict.kind === "needs-setting";
  } catch (error) {
    // Given up by whoever asked: nobody is waiting for the answer, so nothing went wrong.
    if (!asked.signal.aborted) logNotJudged(declared, error);
    return false;
  }
}

/**
 * The failure a card whose judgement ran past its budget becomes, naming the stage that was
 * running. Core's own error, not the plugin's: the stage may be core's check of the collections
 * the widget reads, and nothing the plugin said is in it.
 */
function judgingTimedOut(declared: DeclaredWidget, stage: JudgingStage): never {
  throw new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: "This widget took too long to answer",
    logMessage: `Declared widget "${declared.declaration.id}" of ${declared.owner} was not judged within ${SLOT_TIMEOUT_MS}ms, at its ${stage.at}`,
    logContext: {
      owner: declared.owner,
      widget: declared.declaration.id,
      reason: "widget-judging-timed-out",
      stage: stage.at,
      timeoutMs: SLOT_TIMEOUT_MS,
    },
  });
}

/** That a card could not be judged shown, so it was not, for the operator. */
function logNotJudged(declared: DeclaredWidget, error: unknown): void {
  // Guarded as `failedSlot` guards its own: a log that throws must not decide the card.
  try {
    getNextlyLogger().warn({
      kind: "declared-widget-not-judged",
      ...(NextlyError.is(error)
        ? error.toLogJSON("declared-widget")
        : { owner: declared.owner, widget: declared.declaration.id }),
    });
  } catch {
    // Deliberately swallowed; see above.
  }
}
