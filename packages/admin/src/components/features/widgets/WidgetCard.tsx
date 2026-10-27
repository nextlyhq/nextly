"use client";

/**
 * The one anatomy every dashboard widget wears.
 *
 * Header, body, optional footer — drawn by core for declarative archetypes and
 * for plugin components alike. A plugin contributes a BODY and nothing else,
 * which is what stops one plugin's card from looking unlike the rest of the
 * dashboard and what makes the loading, error and accessibility work below
 * apply to every widget without each author reimplementing it.
 *
 * The frame draws every state from one `CardState` (`frame/card-state`). The
 * renderer hands it the state a batch answer comes to, and a body whose own
 * data says more reports it with `FrameState`; either way the body is drawn
 * only while the card is ready or refreshing, and every other state is drawn
 * here, the same on every card.
 *
 * The HEADER NEVER CHANGES SHAPE. It is one fixed height in every state, size
 * tier and mode: the subject as the title, the widget's own name beneath it
 * when the two differ, then at most one quick control and the card's menu. A
 * row of cards lines up because no state, tier or mode adds or removes a row
 * from it; customise mode draws its controls over it rather than beside it.
 *
 * Refreshing marks the body `aria-busy`; it does not swap in a spinner. A
 * spinner discards the numbers the reader was already looking at on every
 * window-focus refetch — and this grid refetches on focus by convention — so
 * the card would flicker between a value and a spinner for data that usually
 * comes back unchanged.
 *
 * An error replaces the body and KEEPS the title. An anonymous error box on a
 * dashboard of ten cards does not tell the user which widget broke, which is
 * the only thing they need in order to do anything about it. It is ordinary
 * content, NOT a live region: the grid announces for the whole batch through
 * its one polite region, and a card that announced its own error would speak
 * over it.
 *
 * The card says nothing about when its data arrived. Every card's time was the
 * batch's, the same on all of them, so the line under each said one fact many
 * times; the page says it once, and only when it is stale.
 *
 * Colour comes from the `--nx-*` token scale through its semantic Tailwind
 * classes (`bg-card`, `text-muted-foreground`, `text-destructive`), which are
 * defined for light and dark alike. No hex values.
 *
 * @module components/features/widgets/WidgetCard
 */

import { Card, CardContent, CardFooter, CardHeader } from "@nextlyhq/ui";
import type { SizeTier } from "@nextlyhq/ui/format";
import {
  useCallback,
  useId,
  useRef,
  useState,
  type ReactNode,
  type JSX,
} from "react";

import { Link } from "@admin/components/ui/link";
import { cn } from "@admin/lib/utils";

import {
  CardStateReportProvider,
  showsBody,
  type CardState,
  type SkeletonHint,
} from "./frame/card-state";
import { frameIds } from "./frame/ids";
import {
  CardEmpty,
  CardError,
  CardSkeleton,
  CardUnavailable,
  type SkeletonShape,
} from "./frame/states";
import {
  AnswerTierContext,
  CardTierContext,
  rowsDrawn,
  rowsLayout,
  useCardTier,
  useMeasuredTier,
  type RowsLayout,
} from "./frame/tier";

export interface WidgetCardProps {
  /** The card's subject, always rendered, in every state, once. */
  title: string;
  /**
   * The widget's own name, drawn quieter beneath the title when the title names the card's
   * subject instead ("Posts", beneath it "Count"). Absent when the two are the same.
   */
  subtitle?: string | undefined;
  /**
   * Drawn before the title: the drag handle in customise mode. The frame draws nothing there by
   * default.
   */
  leading?: ReactNode;
  /** Drawn at the right of the header: the card's menu, or the room customise mode draws over. */
  headerAction?: ReactNode;
  /** The card's one quick control, just before `headerAction`. */
  quick?: ReactNode;
  /**
   * Customise mode: the body, footer and quick control become inert and dim, so their links and
   * controls are out of reach, while the title stays where it is.
   */
  customizing?: boolean;
  /**
   * What the card shows, `ready` when unstated. A body that reports a state of its own takes
   * this one's place.
   */
  state?: CardState;
  /** The shape the loading skeleton takes. */
  skeleton?: SkeletonShape;
  /**
   * A list or table card's items setting. Its loading skeleton then holds the place of the rows
   * the card will draw at its tier (`rowsDrawn`), so the first answer does not make the card
   * jump; absent, a skeleton draws its default rows.
   */
  skeletonItems?: unknown;
  /**
   * How many columns a list or table card selects. Its loading skeleton then lays its rows out
   * as the card will at its tier (`rowsLayout`): a table, or rows with or without a detail line.
   */
  skeletonFields?: number;
  /** A stats card's cell labels, which its loading skeleton draws under each held value. */
  skeletonCells?: readonly string[];
  /**
   * The widget takes its card off the dashboard while its answer is empty, rather than saying
   * so; customise mode still shows it, marked, so it can be moved or removed.
   */
  hidesWhenEmpty?: boolean;
  /**
   * At most ONE. A footer is not a row of buttons. Shown beside a drawn body and under an empty
   * one, where "View all" still leads somewhere; never while the card is loading, failed or not
   * available, where its destination is the thing that did not answer.
   */
  link?: { label: string; href: string };
  /**
   * The card's id. Names the title (`frameIds`) and marks the root with `data-card-id`, so the
   * code drawing its customise controls can label them after the card.
   */
  cardId?: string;
  /** Marked on the root as `data-width` for styling and tests. */
  width?: string;
  /** The tier the answer drawn in the body was fetched at; provided as `AnswerTierContext`. */
  answerTier?: "small" | "medium" | "large";
  /**
   * The size tier, when the caller knows it better than the card's own measurement. Otherwise
   * the card measures the width it is drawn at (`frame/tier`). Marked on the root as
   * `data-tier`, and handed to every figure inside the card.
   */
  tier?: "small" | "medium" | "large";
  /** The archetype's rendering, or the widget's component. */
  children: ReactNode;
  className?: string;
}

const READY: CardState = { kind: "ready" };

/**
 * The state the card shows: the one it was handed, or, while that one draws the body, the state
 * the body reported in its place.
 */
function shownState(given: CardState, reported: CardState | null): CardState {
  return showsBody(given) && reported !== null ? reported : given;
}

/** What `data-state` says for a state: the names the dashboard's tests and styles read. */
function stateName(state: CardState): string {
  return state.kind === "no-access" ? "unavailable" : state.kind;
}

/** The body's classes: top-aligned, dimmed through a refresh and in customise mode. */
function bodyClassName(refreshing: boolean, customizing: boolean): string {
  return cn(
    // Top-aligned, not centred: cards in a grid row stretch to the tallest of them, so centring
    // floats a one-line figure in the middle of whatever the tallest card happens to be.
    "flex min-h-0 flex-1 flex-col justify-start overflow-visible p-0 pt-3",
    refreshing && "opacity-60 transition-opacity",
    customizing && "opacity-55"
  );
}

/**
 * What the frame derives from the state it shows, decided once so the markup below only reads it:
 * whether the grid should take the card out, whether customise mode marks it as hidden, whether
 * its quick control is out of reach, how its body is marked, and whether its footer link shows.
 */
function frameFlags(
  props: Pick<WidgetCardProps, "hidesWhenEmpty" | "link">,
  state: CardState,
  customizing: boolean
) {
  const hidden = props.hidesWhenEmpty === true && state.kind === "empty";
  return {
    hiddenEmpty: hidden && !customizing,
    markedHidden: hidden && customizing,
    // A quick control changes the question; before the first answer there is no question on
    // show to change, and in customise mode the card's menu stands there.
    quickInert: state.kind === "loading" || customizing,
    busy: state.kind === "loading" || state.kind === "refreshing",
    refreshing: state.kind === "refreshing",
    // Beside a drawn body and under an empty one; never while loading, failed or not available.
    footer:
      props.link !== undefined && (showsBody(state) || state.kind === "empty"),
  };
}

export function WidgetCard(props: WidgetCardProps): JSX.Element {
  const { title, cardId } = props;
  const generatedId = useId();
  const titleId = cardId ? frameIds(cardId).titleId : generatedId;
  const customizing = props.customizing === true;
  // What the body reported, while it is drawn. Withdrawn by the body itself when it unmounts.
  const [reported, setReported] = useState<CardState | null>(null);
  const report = useCallback((next: CardState | null) => setReported(next), []);
  const given = props.state ?? READY;
  const state = shownState(given, reported);
  const drawsBody = showsBody(given);
  const flags = frameFlags(props, state, customizing);
  // The width the card is drawn at decides how its figures are written; see `frame/tier`.
  const rootRef = useRef<HTMLDivElement>(null);
  const tier = useMeasuredTier(rootRef, props.tier);

  return (
    <CardTierContext.Provider value={tier}>
      <AnswerTierContext.Provider value={props.answerTier}>
        <Card
          ref={rootRef}
          // `region` + the title as its name is what lets a screen-reader user jump
          // between widgets and know which one they landed on.
          role="region"
          aria-labelledby={titleId}
          data-card-id={cardId}
          data-width={props.width}
          data-tier={tier}
          data-state={stateName(state)}
          // Read by the grid cell, which takes a card whose widget hides when empty out of the
          // grid while it is; never in customise mode, where the card must stay reachable.
          data-hidden-empty={flags.hiddenEmpty ? "" : undefined}
          className={cn("flex h-full flex-col p-4", props.className)}
        >
          <WidgetCardHeader
            titleId={titleId}
            title={title}
            subtitle={props.subtitle}
            leading={props.leading}
            quick={props.quick}
            quickInert={flags.quickInert}
            headerAction={props.headerAction}
          />

          <CardContent
            data-testid="widget-card-body"
            aria-busy={flags.busy}
            // Customise mode: what the card shows stays visible, but nothing in it can be reached.
            inert={customizing || undefined}
            className={bodyClassName(flags.refreshing, customizing)}
          >
            {flags.markedHidden ? (
              <p
                className="mb-2 text-xs font-medium text-muted-foreground"
                data-testid="hidden-while-empty"
              >
                Hidden while empty
              </p>
            ) : null}
            <StateBody state={state} title={title} props={props} />
            {/* The body stays mounted while it reports a state, so the data it reads keeps
                arriving; what it renders then is its report, which draws nothing. */}
            {drawsBody ? (
              <CardStateReportProvider value={report}>
                {props.children}
              </CardStateReportProvider>
            ) : null}
          </CardContent>

          {flags.footer && props.link !== undefined ? (
            <WidgetCardFooter link={props.link} inert={customizing} />
          ) : null}
        </Card>
      </AnswerTierContext.Provider>
    </CardTierContext.Provider>
  );
}

/**
 * What the body area draws for a state that is not the body: the skeleton, the error, the
 * no-access notice or the empty notice. Nothing for ready and refreshing, where the body is
 * drawn instead.
 */
function StateBody({
  state,
  title,
  props,
}: {
  state: CardState;
  title: string;
  props: Pick<
    WidgetCardProps,
    "skeleton" | "skeletonItems" | "skeletonFields" | "skeletonCells"
  >;
}) {
  switch (state.kind) {
    case "loading":
      return <LoadingBody hint={state.skeleton} props={props} />;
    case "error":
      return (
        <CardError
          message={state.message}
          title={title}
          onRetry={state.retry}
        />
      );
    case "no-access":
      return <CardUnavailable />;
    case "empty":
      return <CardEmpty {...state.empty} />;
    default:
      return null;
  }
}

/**
 * The loading skeleton: shaped as the body reported, or else as the card's own declaration says,
 * holding the place of the rows the card will draw at its tier, by the rule the list and table
 * bodies draw by. Medium until the card has measured itself, as those bodies are.
 */
function LoadingBody({
  hint,
  props,
}: {
  hint: SkeletonHint | undefined;
  props: Pick<
    WidgetCardProps,
    "skeleton" | "skeletonItems" | "skeletonFields" | "skeletonCells"
  >;
}) {
  const tier = useCardTier() ?? "medium";
  return (
    <CardSkeleton
      shape={hint?.shape ?? props.skeleton}
      rows={hint?.rows ?? heldRows(tier, props.skeletonItems)}
      layout={hint?.layout ?? heldLayout(tier, props.skeletonFields)}
      cells={props.skeletonCells}
    />
  );
}

/** The rows a list or table card's skeleton holds at `tier`, from its items setting. */
function heldRows(tier: SizeTier, items: unknown): number | undefined {
  return items === undefined ? undefined : rowsDrawn(tier, items);
}

/** How a list or table card's skeleton lays its rows out at `tier`, from its column count. */
function heldLayout(
  tier: SizeTier,
  fields: number | undefined
): RowsLayout | undefined {
  return fields === undefined ? undefined : rowsLayout(tier, fields);
}

/**
 * The card's header, one fixed height in every state, tier and mode.
 *
 * The title is one line, shortened with an ellipsis, its full text on hover and to assistive
 * technology (the heading's text is never cut, only its drawing). The subtitle beneath it is the
 * widget's own name. The quick control and the menu sit at the right end, always in that order,
 * so the menu is in the same place on every card.
 */
function WidgetCardHeader({
  titleId,
  title,
  subtitle,
  leading,
  quick,
  quickInert,
  headerAction,
}: {
  titleId: string;
  title: string;
  subtitle?: string | undefined;
  leading?: ReactNode;
  quick?: ReactNode;
  quickInert: boolean;
  headerAction?: ReactNode;
}) {
  return (
    <CardHeader
      // No rule under the header: a divider is the difference between a card and a panel.
      noBorder
      data-testid="widget-card-header"
      className="h-10 shrink-0 flex-row items-center gap-2 space-y-0 p-0"
    >
      {leading && <span className="-ml-2 shrink-0">{leading}</span>}
      <div className="min-w-0 flex-1">
        {/* One heading level for every card, under the page's h1, in the one title style of
            the card type ramp (14 px, semibold). */}
        <h2
          id={titleId}
          title={title}
          className="truncate text-sm font-semibold leading-5 tracking-tight text-foreground"
        >
          {title}
        </h2>
        {subtitle && (
          <p
            className="truncate text-xs leading-4 text-muted-foreground"
            data-testid="widget-card-subtitle"
          >
            {subtitle}
          </p>
        )}
      </div>
      {quick && (
        <span
          className="shrink-0"
          inert={quickInert || undefined}
          aria-disabled={quickInert || undefined}
        >
          {quick}
        </span>
      )}
      {headerAction && <span className="shrink-0">{headerAction}</span>}
    </CardHeader>
  );
}

/** The single footer link, on the right. */
function WidgetCardFooter({
  link,
  inert,
}: {
  link: { label: string; href: string };
  /** Customise mode: the footer's link is out of reach, like the body's. */
  inert: boolean;
}) {
  return (
    <CardFooter
      data-testid="widget-card-footer"
      inert={inert || undefined}
      // No top rule and no tint: `CardFooter` defaults to both, which reads as a separate element
      // attached to the card rather than as part of it.
      className="flex items-center justify-end border-0 bg-transparent p-0 pt-3"
    >
      {/* Foreground, with the brand on the underline: a brand primary is any colour its owner
          picked, and small text in it can fall under AA contrast. */}
      <Link
        href={link.href}
        className="text-xs font-medium text-foreground underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:decoration-primary"
      >
        {link.label}
      </Link>
    </CardFooter>
  );
}
