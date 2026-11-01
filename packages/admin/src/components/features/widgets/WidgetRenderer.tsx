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

import type { SizeTier } from "@nextlyhq/ui/format";
import type { GridSize } from "nextly/config";
import type { JSX, ReactNode } from "react";

import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import type { CellSlotLookup } from "./archetypes/types";
import { DeclaredComponent, useComponentDraw } from "./declared-component";
import { DREW_NOTHING, missingComponentMessage } from "./draw-failures";
import { preloadWidgetSettingsSheet } from "./edit/settings-sheet-code";
import type { CardState } from "./frame/card-state";
import { listDensityOf } from "./frame/list-rows";
import type { CardEmptyContent, SkeletonShape } from "./frame/states";
import type { AnswerSize } from "./frame/tier";
import {
  useHiddenWhileEmpty,
  useHidesWhenAnswerEmpty,
} from "./hidden-while-empty";
import { resolveWidgetOutcome, type WidgetOutcome } from "./outcome";
import { WidgetCard } from "./WidgetCard";

/**
 * The shape a card's skeleton takes while its data has never arrived, from what its
 * archetype will draw: a figure where a number goes, rows where a list goes. Matching the
 * shape is what keeps the card from jumping when the data lands.
 */
/**
 * What the card's skeleton is drawn as: the display a declared widget says it looks like (its
 * `skeleton`, published as its `sketch`), else its archetype's. The ONE value its shape, its rows
 * and their layout are all read from, so a declared list's skeleton is a list's rows and a
 * declared table's a table's, never a list's shape with a custom card's rows.
 */
function skeletonDisplayOf(definition: DashboardWidget): string {
  return definition.sketch ?? definition.archetype;
}

/**
 * The columns a declared table's skeleton holds the place of, beside its title: a table drawn by
 * the widget's own component asks no query the count could be read from, so the skeleton stands
 * in with two, which draws a table's heading and columns at the large tier and a row's detail
 * line below it.
 */
const DECLARED_TABLE_COLUMNS = 2;

/**
 * The items setting a list or table card's skeleton holds the place of, from the query as asked;
 * `null` for one that declared no limit, which draws the default number, and `undefined` for any
 * other card, whose skeleton draws its default rows.
 */
function skeletonItemsFor(definition: DashboardWidget): unknown {
  const display = skeletonDisplayOf(definition);
  if (display !== "list" && display !== "table") return undefined;
  return definition.query?.limit ?? null;
}

/**
 * How many columns a list or table card selects, which is how its skeleton is laid out at each
 * tier. Undefined for any other card, whose skeleton has no rows to lay out. A declared table,
 * which asks no query, stands in with `DECLARED_TABLE_COLUMNS`.
 */
function skeletonFieldsFor(definition: DashboardWidget): number | undefined {
  const display = skeletonDisplayOf(definition);
  if (display !== "list" && display !== "table") return undefined;
  if (definition.query === undefined && display === "table") {
    return DECLARED_TABLE_COLUMNS;
  }
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
 * button that does, where the card can open them. Where it cannot (customising, or no settings
 * write), the button is left out and its words become the detail line, "Choose collection in the
 * card's settings.", so the card still says where the missing setting is chosen. The button
 * starts loading the settings sheet as a reader heads for it.
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
    ? { ...words, detail: `${action.label} in the card's settings.` }
    : {
        ...words,
        action: {
          label: action.label,
          onSelect: onOpenSettings,
          onIntent: preloadWidgetSettingsSheet,
        },
      };
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
  /**
   * Draws the card's title as a control: the dashboard's cards open their quick popover from it.
   *
   * @internal Set by the dashboard grid only, never part of the widget kit.
   */
  titleTrigger?: ((title: string) => ReactNode) | undefined;
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
   * The size tier to draw at, where the caller knows it better than the card's own measurement:
   * a card drawn somewhere other than its place on the dashboard, as the settings panel's
   * preview is, scaled to fit, whose measured width is not the width it will have.
   */
  tier?: SizeTier;
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
    | "titleTrigger"
    | "leading"
    | "customizing"
    | "answerSize"
    | "subtitle"
    | "tier"
  > & { hiddenWhileEmpty: boolean; hidesWhenAnswerEmpty: boolean }
) {
  const { hiddenWhileEmpty, hidesWhenAnswerEmpty, ...rest } = controls;
  const hides = definition.hidesWhenEmpty === true;
  return {
    title: definition.title,
    link: definition.link,
    ...rest,
    hiddenWhileEmpty: hides && hiddenWhileEmpty,
    hidesWhenAnswerEmpty: hides && hidesWhenAnswerEmpty,
    cardId: placement?.id ?? definition.id,
    widgetId: definition.id,
    // The card's height, which its list rows are counted from.
    ...(placement?.size === undefined ? {} : { h: placement.size.h }),
    // The display the widget says it looks like, else its archetype's: a
    // declared card's `skeleton`, published as its `sketch`.
    skeleton: skeletonFor(skeletonDisplayOf(definition)),
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

/** What a self-drawn card's component is handed: which card it is, and its reader's settings. */
type SelfDrawnProps = {
  widgetId: string;
  placementId: string;
  settings: Record<string, unknown>;
};

/**
 * The props a self-drawn widget's component receives: Create's, core's one
 * card still written as a definition, which asks for nothing and draws from
 * the session alone. A widget declared with `defineWidget` is drawn by
 * `DeclaredComponent` instead, handed its data.
 */
function componentPropsFor(
  definition: WidgetRendererProps["definition"],
  placement: WidgetRendererProps["placement"]
): SelfDrawnProps {
  return {
    widgetId: definition.id,
    placementId: placement?.id ?? definition.id,
    settings: placement?.settings ?? {},
  };
}

/**
 * A custom card's own component, inside the frame. It is reached with an answer or while one is
 * on the way; a failed answer is the frame's (`resolveWidgetOutcome`), and anything the answer
 * says beyond that the component reports with `FrameState`.
 */
function selfDrawnCard(
  definition: WidgetRendererProps["definition"],
  shared: ReturnType<typeof sharedCardProps>,
  componentProps: SelfDrawnProps,
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

/**
 * What a card about to draw its own component says when the admin holds no component at its
 * path, or `undefined` while it does or will not draw one.
 *
 * 🔴 That card draws its error instead, and the grid counts it as failed: never an empty body
 * that reads as drawn. Only where the component would be drawn, so a card the reader may not
 * see, or one still loading, says that first.
 */
function useMissingComponent(
  definition: WidgetRendererProps["definition"],
  outcome: WidgetOutcome
): string | undefined {
  // The server's answer to whether it runs in development (`devReload`): this
  // package's own NODE_ENV says where the library was built, not where it runs.
  const development = useBranding().devReload === true;
  return outcome.state === "self-drawn" || outcome.state === "answered"
    ? missingComponentMessage(definition, development)
    : undefined;
}

/**
 * A card whose component is missing: its error, and no Retry, since drawing again finds the same
 * registry.
 */
function missingCard(
  shared: ReturnType<typeof sharedCardProps>,
  message: string,
  isFetching: boolean
): JSX.Element {
  const drawn = cardForOutcome({ state: "failed", message }, { isFetching });
  return (
    <WidgetCard {...shared} state={drawn.state}>
      {drawn.body}
    </WidgetCard>
  );
}

/**
 * The card for its outcome: its error where its component is missing, the component with no
 * answer to wait for, a declared widget's component with its answer, or the frame's own state.
 *
 * A declared widget's component is drawn with the answer its `load` gave, the frame marking the
 * card busy through a refetch as for any card; a failed answer never reaches it
 * (`resolveWidgetOutcome`).
 */
function cardFor(
  definition: WidgetRendererProps["definition"],
  shared: ReturnType<typeof sharedCardProps>,
  outcome: WidgetOutcome,
  live: {
    missing: string | undefined;
    draw: ReturnType<typeof useComponentDraw>;
    componentProps: SelfDrawnProps;
    placement: WidgetRendererProps["placement"];
    isFetching: boolean;
    onRetry: (() => void) | undefined;
    /** Opens this card's settings from its empty state, where the card can. */
    onOpenSettings: (() => void) | undefined;
  }
): JSX.Element {
  if (live.missing !== undefined) {
    return missingCard(shared, live.missing, live.isFetching);
  }
  if (outcome.state === "self-drawn") {
    return selfDrawnCard(
      definition,
      shared,
      live.componentProps,
      live.isFetching
    );
  }
  if (outcome.state === "answered") {
    return declaredCard(definition, shared, outcome.data, live.draw, live);
  }
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

export function WidgetRenderer({
  definition,
  slot,
  slotFor,
  placement,
  headerAction,
  quick,
  titleTrigger,
  leading,
  customizing = false,
  onRetry,
  onOpenSettings,
  isFetching = false,
  answerSize,
  subtitle,
  tier,
}: WidgetRendererProps): JSX.Element {
  // Taken off the dashboard while empty by the layout read's verdict, held for the visit; or, for
  // a widget the layout read cannot answer, by its own answer as it is drawn.
  const hiddenWhileEmpty = useHiddenWhileEmpty(placement?.id);
  const hidesWhenAnswerEmpty = useHidesWhenAnswerEmpty(definition.id);
  const shared = sharedCardProps(definition, placement, {
    headerAction,
    quick,
    titleTrigger,
    leading,
    customizing,
    answerSize,
    subtitle,
    hiddenWhileEmpty,
    hidesWhenAnswerEmpty,
    ...(tier === undefined ? {} : { tier }),
  });

  const outcome = resolveWidgetOutcome(definition, slot, slotFor);
  const missing = useMissingComponent(definition, outcome);
  // Whether a declared widget's own component threw drawing this answer, or is
  // missing: asked for every card, as a hook must be, and false for any other.
  const draw = useComponentDraw({
    slot,
    isFetching,
    ...(onRetry ? { onRetry } : {}),
    placementId: placement?.id ?? definition.id,
    missing: missing !== undefined,
  });
  // Built once, so every render of a self-drawn card is handed the same props.
  const componentProps = componentPropsFor(definition, placement);

  return cardFor(definition, shared, outcome, {
    missing,
    draw,
    componentProps,
    placement,
    isFetching,
    onRetry,
    onOpenSettings,
  });
}
