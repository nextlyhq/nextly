"use client";

/**
 * Dispatches a widget to its archetype body, inside the one card.
 *
 * The card is drawn HERE rather than by each archetype, so an archetype added
 * later contributes a body function and inherits the header, the footer, the
 * busy state, the error presentation and the region label without deciding any
 * of them again. Adding `table`, `list`, `text` and `actions` is one entry in
 * `ARCHETYPE_BODIES` each.
 *
 * WHICH of those states a widget is in is decided by `resolveWidgetOutcome`
 * rather than here, because the grid has to count the same answer for its live
 * region. See `./outcome`.
 *
 * `custom` is the exception, and it does NOT get a second resolution path: it
 * goes through `PluginSlot`, which already resolves a component path against
 * the registry and already isolates a throw behind `PluginComponentBoundary`.
 * A widget-specific resolver beside it would be a second place for a plugin
 * component to fail differently.
 *
 * @module components/features/widgets/WidgetRenderer
 */

import type { GridSize } from "nextly/config";
import type { WidgetComponentProps } from "nextly/widget-result";
import type { JSX, ReactNode } from "react";

import { PluginSlot } from "@admin/components/shared/plugin-slot";
import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import type { CellSlotLookup } from "./archetypes/types";
import { DeclaredComponent, useComponentDraw } from "./declared-component";
import { DREW_NOTHING } from "./draw-failures";
import type { CardState } from "./frame/card-state";
import { listDensityOf } from "./frame/list-rows";
import type { CardEmptyContent, SkeletonShape } from "./frame/states";
import type { AnswerSize } from "./frame/tier";
import { resolveWidgetOutcome, type WidgetOutcome } from "./outcome";
import { askableQuery } from "./widget-as-asked";
import { WidgetCard } from "./WidgetCard";

/**
 * The shape a card's skeleton takes while its data has never arrived, from what its
 * archetype will draw: a figure where a number goes, rows where a list goes. Matching the
 * shape is what keeps the card from jumping when the data lands.
 */
/**
 * The items setting a list or table card's skeleton holds the place of, from the query as asked;
 * `null` for one that declared no limit, which draws the default number, and `undefined` for any
 * other card, whose skeleton draws its default rows.
 */
function skeletonItemsFor(definition: DashboardWidget): unknown {
  if (definition.archetype !== "list" && definition.archetype !== "table")
    return undefined;
  return definition.query?.limit ?? null;
}

/**
 * How many columns a list or table card selects, which is how its skeleton is laid out at each
 * tier. Undefined for any other card, whose skeleton has no rows to lay out.
 */
function skeletonFieldsFor(definition: DashboardWidget): number | undefined {
  if (definition.archetype !== "list" && definition.archetype !== "table")
    return undefined;
  return definition.query?.select?.length ?? 0;
}

function skeletonFor(archetype: string): SkeletonShape {
  switch (archetype) {
    case "metric":
      return "figure";
    case "stats":
      return "stats";
    case "timeseries":
      return "chart";
    case "bars":
      return "bars";
    case "actions":
      return "actions";
    case "text":
      return "text";
    default:
      return "rows";
  }
}

/** What a card its widget does not show for this person says, where customise mode shows it. */
const NOT_SHOWN = "Not shown for you right now";

/** Every outcome the frame draws itself, which is all but a plugin's own component. */
type FramedOutcome = Exclude<
  WidgetOutcome,
  { state: "self-drawn" } | { state: "answered" }
>;

/**
 * The state a card with an answer on show is in: refreshing while a new one is on the way, which
 * keeps the answer drawn and marks it busy rather than replacing it, and otherwise ready.
 */
function answeredState(isFetching: boolean): CardState {
  return isFetching ? { kind: "refreshing" } : { kind: "ready" };
}

/**
 * An empty card's content as the frame draws it: an action opening the card's settings becomes a
 * button that does, where the card can open them, and is left out where it cannot.
 */
function drawnEmpty(
  empty: Extract<WidgetOutcome, { state: "empty" }>["empty"],
  onOpenSettings: (() => void) | undefined
): CardEmptyContent {
  const { action, ...words } = empty;
  if (action === undefined || !("opensSettings" in action)) {
    return action === undefined ? words : { ...words, action };
  }
  return onOpenSettings === undefined
    ? words
    : { ...words, action: { label: action.label, onSelect: onOpenSettings } };
}

/**
 * The card's state and body for one outcome.
 *
 * One mapping, so each state's rules sit side by side: only a failure offers Retry, and only an
 * answer is drawn as a body.
 */
function cardForOutcome(
  outcome: FramedOutcome,
  live: {
    isFetching: boolean;
    onRetry?: (() => void) | undefined;
    onOpenSettings?: (() => void) | undefined;
  }
): { state: CardState; body: ReactNode; notShown?: true } {
  switch (outcome.state) {
    case "not-shown":
      // Drawn as an empty card the frame takes off the dashboard, as it takes a card hidden
      // while empty, and marks in customise mode instead.
      return {
        state: { kind: "empty", empty: { title: NOT_SHOWN } },
        body: null,
        notShown: true,
      };
    case "loading":
      // Data has never arrived: a skeleton shaped like the body, not an empty busy card.
      return { state: { kind: "loading" }, body: null };
    case "unavailable":
      return { state: { kind: "no-access" }, body: null };
    case "failed":
      return {
        state: {
          kind: "error",
          message: outcome.message,
          ...(live.onRetry ? { retry: live.onRetry } : {}),
        },
        body: null,
      };
    case "empty":
      return {
        state: {
          kind: "empty",
          empty: drawnEmpty(outcome.empty, live.onOpenSettings),
        },
        body: null,
      };
    case "ready":
      return { state: answeredState(live.isFetching), body: outcome.node };
  }
}

export interface WidgetRendererProps {
  definition: DashboardWidget;
  /**
   * A control the HOST puts in this card's header, where one is drawn.
   *
   * 🔴 Passed through the card rather than floated over the cell, because
   * `WidgetCard` already places the declared icon in that same corner and
   * reserves no space for anything else — so a control positioned absolutely
   * there covers the icon on any card that declares one, and whatever an
   * unframed plugin component drew in its own corner.
   *
   */
  headerAction?: ReactNode;
  /**
   * The widget's own name, drawn under the title when the title names the card's subject
   * instead ("Posts", beneath it "Count").
   */
  subtitle?: string | undefined;
  /** The card's one quick setting, which the frame draws before `headerAction`. */
  quick?: ReactNode;
  /** The drag handle in customise mode, drawn before the title. */
  leading?: ReactNode;
  /** Customise mode: the card's content stays visible but out of reach. */
  customizing?: boolean;
  /** Reload this card only, offered when its data failed to load. */
  onRetry?: () => void;
  /**
   * Open this card's own settings, with focus on their first field: what a declared empty
   * action of `opens: "settings"` does. Given only where the reader can change this card's
   * settings; without it that action is not drawn, so nobody is offered a step they cannot take.
   */
  onOpenSettings?: () => void;
  /**
   * This widget's slot from the batch. `undefined` means the batch has not
   * answered yet — which is why a data widget with no slot is BUSY rather than
   * empty, and a widget that asked for nothing is neither.
   */
  slot: WidgetSlot | undefined;
  /**
   * How a `stats` card reaches each cell's answer.
   *
   * Optional, and absent for every archetype that asks one question: their
   * answer arrives in `slot` above. A stats card's numbers are keyed per cell,
   * so its own `slot` is permanently undefined and this is where its data is.
   */
  slotFor?: CellSlotLookup;
  /**
   * Whether a request for this widget is in flight RIGHT NOW, including a
   * background refetch that is keeping the previous answer on screen.
   *
   * Separate from the slot's absence, which is only ever the first load. This
   * grid refetches on every window focus and the cards deliberately keep their
   * numbers through it, so without this a reader using a screen reader had no
   * way to know the dashboard was reading again.
   */
  isFetching?: boolean;
  /**
   * The size the answer in `slot` was fetched at, when the card has grown past it: a list then
   * draws only the rows that answer was asked for. See `AnswerSizeContext`.
   */
  answerSize?: AnswerSize;
  /**
   * Which CARD this render is, and what its reader configured.
   *
   * 🔴 Handed to a plugin's own component, because nothing else can reach it.
   * `plugin-sdk` is an author's only stable import surface, so a component that
   * cannot receive its settings as props cannot observe them at all — a widget
   * could declare a `text`, `checkbox` or `select` setting, a reader could
   * choose a value, and the component drawing the card would never learn of it.
   * Only `limit` reaches anything otherwise, through the query.
   *
   * The ID travels with them because `widgetId` does not identify a card. The
   * same widget can sit on a dashboard twice with different settings, and a
   * component keying anything — local state, a fetch, a chart instance — on the
   * widget id would have the two copies overwrite each other.
   *
   * Optional, and the fallback is the layout's own rule rather than a guess:
   * `defaultPlacements` names each placement after its widget, because an
   * unarranged dashboard is the one case where the two are genuinely
   * one-to-one. A render outside an arrangement is exactly that case.
   */
  placement?: {
    id: string;
    settings: Record<string, unknown>;
    /** The size the card is drawn at, for the size a declared component is handed. */
    size?: GridSize;
  };
}

/** What the card frame is handed whatever the widget draws: its heading, controls and skeleton. */
function sharedCardProps(
  definition: WidgetRendererProps["definition"],
  placement: WidgetRendererProps["placement"],
  controls: Pick<
    WidgetRendererProps,
    | "headerAction"
    | "quick"
    | "leading"
    | "customizing"
    | "answerSize"
    | "subtitle"
  >
) {
  return {
    title: definition.title,
    link: definition.link,
    ...controls,
    hidesWhenEmpty: definition.hidesWhenEmpty === true,
    cardId: placement?.id ?? definition.id,
    // The card's height, which its list rows are counted from.
    ...(placement?.size === undefined ? {} : { h: placement.size.h }),
    skeleton: skeletonFor(definition.archetype),
    skeletonItems: skeletonItemsFor(definition),
    // The density the card's list rows, and the skeleton holding their place, are drawn at.
    listDensity: listDensityOf(placement?.settings),
    skeletonFields: skeletonFieldsFor(definition),
    // A stats card's labels; a custom card's cells draw no skeleton of their own.
    skeletonCells: definition.cells?.flatMap(cell =>
      "label" in cell ? [cell.label] : []
    ),
  };
}

/**
 * The props a self-drawn widget's component receives.
 *
 * 🔴 RETURNS the published type rather than an inferred one. `PluginSlot`
 * forwards `Record<string, unknown>`, so nothing downstream would object to a
 * renamed, dropped or retyped prop here -- and plugin authors compile against
 * `WidgetComponentProps`, which would go on describing the old shape. That is
 * the same parallel-definition drift this contract exists to end, so the
 * producer is held to it here, where a mismatch fails to compile.
 */
function componentPropsFor(
  definition: WidgetRendererProps["definition"],
  slot: WidgetRendererProps["slot"],
  placement: WidgetRendererProps["placement"],
  live: {
    isFetching: boolean;
    onRetry?: () => void;
    cells?: Record<string, WidgetSlot>;
  }
): WidgetComponentProps {
  return {
    widgetId: definition.id,
    placementId: placement?.id ?? definition.id,
    settings: placement?.settings ?? {},
    slot,
    // Each declared read's answer by key, for a custom card that declares
    // several; absent for every other card.
    ...(live.cells === undefined ? {} : { cells: live.cells }),
    isFetching: live.isFetching,
    // The Retry the frame's error offers, for a component whose own data reports an error.
    ...(live.onRetry ? { onRetry: live.onRetry } : {}),
    // The query as asked, which `definition` already is: the grid draws each card
    // from the same declaration the batch sent. One with no source yet was not
    // asked, so it is not handed on.
    ...(askableQuery(definition.query) ? { query: definition.query } : {}),
  };
}

/**
 * A custom card's answers by cell key, for a card that declares several reads;
 * `undefined` for any other card, which is handed `slot` alone.
 */
function customCellAnswers(
  definition: WidgetRendererProps["definition"],
  slotFor: CellSlotLookup | undefined
): Record<string, WidgetSlot> | undefined {
  if (definition.archetype !== "custom" || !definition.cells?.length) {
    return undefined;
  }
  return cellAnswersOf(
    definition.cells.map(cell => cell.key),
    slotFor
  );
}

/** Each cell's answer by key, leaving out the keys with none yet. */
function cellAnswersOf(
  keys: readonly string[],
  slotFor: CellSlotLookup | undefined
): Record<string, WidgetSlot> {
  const answers: Record<string, WidgetSlot> = Object.create(null);
  for (const key of keys) {
    const answer = slotFor?.(key);
    if (answer !== undefined) answers[key] = answer;
  }
  return answers;
}

/**
 * A custom card's own component, inside the frame. It is reached with an answer or while one is
 * on the way; a failed answer is the frame's (`resolveWidgetOutcome`), and anything the answer
 * says beyond that the component reports with `FrameState`.
 */
function selfDrawnCard(
  definition: WidgetRendererProps["definition"],
  shared: ReturnType<typeof sharedCardProps>,
  componentProps: WidgetComponentProps,
  isFetching: boolean
): JSX.Element {
  return (
    <WidgetCard {...shared} state={answeredState(isFetching)}>
      <PluginSlot path={definition.component} props={componentProps} />
    </WidgetCard>
  );
}

/**
 * A declared widget's own component, with its data, inside the frame, which
 * has already drawn every other state, marked busy through a refetch like any
 * card with an answer.
 *
 * 🔴 A throw while drawing is the FRAME's error state, not a body swapped
 * inside a card that still says it is ready: the card's state, its footer and
 * quick setting, and the grid's count all read it as failed, and its Retry
 * draws again once the answer it asks for has settled (`useComponentDraw`).
 */
function declaredCard(
  definition: WidgetRendererProps["definition"],
  shared: ReturnType<typeof sharedCardProps>,
  data: unknown,
  draw: ReturnType<typeof useComponentDraw>,
  live: {
    placement: WidgetRendererProps["placement"];
    isFetching: boolean;
    onRetry: (() => void) | undefined;
  }
): JSX.Element {
  if (draw.failed) {
    const drawn = cardForOutcome(
      { state: "failed", message: DREW_NOTHING },
      { isFetching: live.isFetching, onRetry: draw.retry }
    );
    return (
      <WidgetCard {...shared} state={drawn.state}>
        {drawn.body}
      </WidgetCard>
    );
  }
  return (
    <WidgetCard {...shared} state={answeredState(live.isFetching)}>
      <DeclaredComponent
        key={draw.drawKey}
        definition={definition}
        placement={live.placement}
        data={data}
        refreshing={live.isFetching}
        {...(live.onRetry ? { onRetry: live.onRetry } : {})}
        onCaught={draw.caught}
      />
    </WidgetCard>
  );
}

export function WidgetRenderer({
  definition,
  slot,
  slotFor,
  placement,
  headerAction,
  quick,
  leading,
  customizing = false,
  onRetry,
  onOpenSettings,
  isFetching = false,
  answerSize,
  subtitle,
}: WidgetRendererProps): JSX.Element {
  const shared = sharedCardProps(definition, placement, {
    headerAction,
    quick,
    leading,
    customizing,
    answerSize,
    subtitle,
  });

  const outcome = resolveWidgetOutcome(definition, slot, slotFor);
  // Whether a declared widget's own component threw drawing this answer: asked
  // for every card, as a hook must be, and false for any other.
  const draw = useComponentDraw({
    slot,
    isFetching,
    ...(onRetry ? { onRetry } : {}),
    placementId: placement?.id ?? definition.id,
  });
  // A custom card that declares several reads is handed each answer by key; a
  // key with no answer yet is left out, as `slot` is.
  const cellAnswers = customCellAnswers(definition, slotFor);

  // Built once, so every card drawn by a component is handed the same props.
  const componentProps = componentPropsFor(definition, slot, placement, {
    ...(cellAnswers === undefined ? {} : { cells: cellAnswers }),
    isFetching,
    onRetry,
  });

  // A component drawn with the batch's answer: `custom` may carry a query,
  // which the grid puts in the batch rather than leaving the component to ask
  // again. `undefined` while that answer is on the way, which the component
  // reports as loading; a failed answer never reaches it (`resolveWidgetOutcome`).
  //
  // It is told when a refetch is in flight, because `slot` alone cannot say it:
  // the slot holds the PREVIOUS answer during a refetch and is indistinguishable
  // from idle. The frame marks the card busy then, as for any card.
  if (outcome.state === "self-drawn") {
    return selfDrawnCard(definition, shared, componentProps, isFetching);
  }

  if (outcome.state === "answered") {
    return declaredCard(definition, shared, outcome.data, draw, {
      placement,
      isFetching,
      onRetry,
    });
  }

  return framedCard(shared, outcome, { isFetching, onRetry, onOpenSettings });
}

/** A card the frame draws itself, in the state its outcome decides (`cardForOutcome`). */
function framedCard(
  shared: ReturnType<typeof sharedCardProps>,
  outcome: FramedOutcome,
  live: Parameters<typeof cardForOutcome>[1]
): JSX.Element {
  const drawn = cardForOutcome(outcome, live);
  return (
    <WidgetCard
      {...shared}
      state={drawn.state}
      {...(drawn.notShown ? { notShown: true } : {})}
    >
      {drawn.body}
    </WidgetCard>
  );
}
