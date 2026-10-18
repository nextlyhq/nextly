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
 * Two decisions that are easy to get backwards:
 *
 * Loading marks the body `aria-busy`; it does not swap in a spinner. A spinner
 * discards the numbers the reader was already looking at on every window-focus
 * refetch — and this grid refetches on focus by convention — so the card would
 * flicker between a value and a spinner for data that usually comes back
 * unchanged. `aria-busy` says the same thing to a screen reader without
 * destroying the visible state.
 *
 * An error replaces the body and KEEPS the title. An anonymous error box on a
 * dashboard of ten cards does not tell the user which widget broke, which is
 * the only thing they need in order to do anything about it.
 *
 * And it is ordinary content, NOT a live region. `role="alert"` is assertive by
 * definition, so a card that used it became its own interrupting announcer:
 * five widgets failing at once produced five announcements that spoke over each
 * other and over the grid's single polite one. The grid owns announcing for the
 * whole batch, following `EntryForm/DocumentStatusLive`, and the card's job is
 * to be findable afterwards -- which the region landmark and its title already
 * do.
 *
 * The card is FLAT AND BORDERED, with no internal rules. It sits on a dashboard
 * beside the Users and Roles stat cards, and a plugin's widget that reads as a
 * different component is a plugin that looks bolted on. Those neighbours are a
 * single padded surface: one outer border, the figure large, its label small and
 * muted, an icon in the top-right corner. So the header divider is off, the
 * footer is a quiet line inside the card rather than a tinted strip under a
 * rule, the padding is one step at every level, and the icon moves to the right
 * where the neighbours put theirs. Two borders and a filled band across the
 * bottom made a card twice the visual weight of the ones next to it.
 *
 * Colour comes from the `--nx-*` token scale through its semantic Tailwind
 * classes (`bg-card`, `text-muted-foreground`, `text-destructive`), which are
 * defined for light and dark alike. No hex values.
 *
 * @module components/features/widgets/WidgetCard
 */

import { Card, CardContent, CardFooter, CardHeader } from "@nextlyhq/ui";
import { useId, useRef, type ReactNode } from "react";

import { Link } from "@admin/components/ui/link";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { useRelativeTime } from "@admin/hooks/useRelativeTime";
import { cn } from "@admin/lib/utils";

import { frameIds } from "./frame/ids";
import {
  CardEmpty,
  CardError,
  CardSkeleton,
  CardUnavailable,
  type CardEmptyContent,
  type SkeletonShape,
} from "./frame/states";
import {
  CardTierContext,
  rowsDrawn,
  useCardTier,
  useMeasuredTier,
} from "./frame/tier";

/**
 * What the body shows, besides its content.
 *
 * - `ready`: the content (`children`); `isLoading` alongside it is a REFRESH, which keeps the
 *   last value on screen and marks it busy.
 * - `loading`: data has never arrived, so a skeleton shaped like the body stands in.
 * - `empty`: nothing to show; the card says what will appear and offers at most one action.
 * - `unavailable`: the source is forbidden, gone, or kept off the dashboard, all said the same
 *   way.
 *
 * An error is not listed here: `error` set to a message is the error state, whatever this says,
 * because a card that failed must not go on showing a value.
 */
export type CardState = "ready" | "loading" | "empty" | "unavailable";

export interface WidgetCardProps {
  /** Always rendered, in every state, once. */
  title: string;
  /** One optional line under the title. */
  description?: string;
  /** Optional, and functional rather than decorative — an icon per card is noise. */
  icon?: ReactNode;
  /**
   * Drawn before the title: the drag handle in customise mode. The frame draws nothing there by
   * default.
   */
  leading?: ReactNode;
  /** Drawn at the right of the header: the width label and the card menu in customise mode. */
  headerAction?: ReactNode;
  /** The card's one quick setting, drawn just before `headerAction`, outside customise mode. */
  quick?: ReactNode;
  /**
   * Customise mode: the body and footer become inert and dim, so their links and controls are
   * out of reach, while the title stays where it is -- the title appears once in every mode.
   */
  customizing?: boolean;
  /** See `CardState`. Defaults to `ready`. */
  state?: CardState;
  /** The shape the loading skeleton takes. */
  skeleton?: SkeletonShape;
  /**
   * A list or table card's items setting. Its loading skeleton then holds the place of the rows
   * the card will draw at its tier (`rowsDrawn`), so the first answer does not make the card
   * jump; absent, a skeleton draws its default rows.
   */
  skeletonItems?: unknown;
  /** What an empty card says. Required for `state="empty"` to say anything specific. */
  empty?: CardEmptyContent;
  /** Retry for this card only, offered in the error state. */
  onRetry?: () => void;
  /** Marks the body busy. Does not replace it. */
  isLoading?: boolean;
  /** Replaces the body. The title stays. */
  error?: string | null;
  /** When this widget's data landed, for the footer's freshness line. */
  updatedAt?: Date | null;
  /** At most ONE. A footer is not a row of buttons. */
  link?: { label: string; href: string };
  /**
   * The card's id. Names the title (`frameIds`) and marks the root with `data-card-id`, so the
   * code drawing its customise controls can label them after the card.
   */
  cardId?: string;
  /** Marked on the root as `data-width` for styling and tests. */
  width?: string;
  /**
   * The size tier, when the caller knows it better than the card's own measurement. Otherwise
   * the card measures the width it is drawn at (`frame/tier`). Marked on the root as
   * `data-tier`, and handed to every figure inside the card.
   */
  tier?: "small" | "medium" | "large";
  /** The archetype's rendering, or the plugin's component. */
  children: ReactNode;
  className?: string;
}

const EMPTY_DEFAULT: CardEmptyContent = { title: "Nothing to show yet" };

/**
 * What the card's state and error come to: what `data-state` says, whether content is on show,
 * and whether the card has an answer its freshness is true of.
 */
function frameRules(state: CardState, error: string | null) {
  const failed = error !== null;
  const showsContent = !failed && state === "ready";
  return {
    // An error wins over whatever `state` claims.
    shown: failed ? "error" : state,
    showsContent,
    // An answer, content or "nothing yet", so the batch's freshness is true of it.
    settled: showsContent || (!failed && state === "empty"),
  };
}

/**
 * What a card that is not showing content withholds, decided once.
 *
 * It offers no "view all": an error's destination is the thing that just failed to answer, and
 * an empty or unavailable card's has nothing more to show. It claims no freshness: the timestamp
 * is when the BATCH landed, which is true of the request and not of this card -- "Updated just
 * now" printed under "This card couldn't load" tells the reader the opposite of what happened.
 * And it offers no quick setting, which would change a question the card is not answering, nor
 * one in customise mode, where the card's menu stands in that place. Here rather than at each
 * caller, so an archetype added later inherits all of it rather than having to remember it.
 */
function frameExtras(
  rules: ReturnType<typeof frameRules>,
  props: WidgetCardProps,
  customizing: boolean
) {
  return {
    quick: rules.showsContent && !customizing ? props.quick : undefined,
    freshness: rules.settled ? (props.updatedAt ?? null) : null,
    link: rules.showsContent ? props.link : undefined,
  };
}

/** Everything the frame derives from its props, so the markup below only reads it. */
function frameView(props: WidgetCardProps) {
  const state = props.state ?? "ready";
  const error = props.error ?? null;
  const customizing = props.customizing === true;
  const rules = frameRules(state, error);
  return {
    ...frameExtras(rules, props, customizing),
    state,
    error,
    customizing,
    shown: rules.shown,
    // Explicitly `false` rather than absent when idle: a reader that saw `aria-busy="true"`
    // needs the attribute to change back, and an omitted attribute is a weaker signal than one
    // that says "no longer busy".
    busy: props.isLoading === true || state === "loading",
    // A refetch over content dims it; a first load or an error has nothing to dim.
    refreshing: props.isLoading === true && rules.showsContent,
  };
}

/**
 * The body's classes.
 *
 * Top-aligned, not centred. Cards in a grid row stretch to the tallest of them, so centring
 * floats a one-line figure in the middle of whatever the tallest card in that row happens to be.
 */
function bodyClassName(refreshing: boolean, customizing: boolean): string {
  return cn(
    "flex flex-1 flex-col justify-start px-5 pb-5 pt-2",
    refreshing && "opacity-60 transition-opacity",
    customizing && "opacity-55"
  );
}

export function WidgetCard(props: WidgetCardProps) {
  const { title, cardId } = props;
  const generatedId = useId();
  const titleId = cardId ? frameIds(cardId).titleId : generatedId;
  const view = frameView(props);
  // The width the card is drawn at decides how its figures are written; see `frame/tier`.
  const rootRef = useRef<HTMLDivElement>(null);
  const tier = useMeasuredTier(rootRef, props.tier);

  return (
    <CardTierContext.Provider value={tier}>
      <Card
        ref={rootRef}
        // `region` + the title as its name is what lets a screen-reader user jump
        // between widgets and know which one they landed on. Without the name a
        // region is worse than no landmark at all.
        role="region"
        aria-labelledby={titleId}
        data-card-id={cardId}
        data-width={props.width}
        data-tier={tier}
        data-state={view.shown}
        className={cn("flex h-full flex-col", props.className)}
      >
        <WidgetCardHeader
          titleId={titleId}
          title={title}
          description={props.description}
          icon={props.icon}
          leading={props.leading}
          quick={view.quick}
          headerAction={props.headerAction}
        />

        <CardContent
          data-testid="widget-card-body"
          aria-busy={view.busy}
          // Customise mode: what the card shows stays visible, but nothing in it can be reached.
          inert={view.customizing || undefined}
          className={bodyClassName(view.refreshing, view.customizing)}
        >
          <WidgetCardBody
            state={view.state}
            error={view.error}
            title={title}
            onRetry={props.onRetry}
            skeleton={props.skeleton}
            skeletonItems={props.skeletonItems}
            empty={props.empty}
          >
            {props.children}
          </WidgetCardBody>
        </CardContent>

        <WidgetCardFooter
          freshness={view.freshness}
          link={view.link}
          inert={view.customizing}
        />
      </Card>
    </CardTierContext.Provider>
  );
}

/**
 * What the body draws for the card's state: the error, the skeleton, the unavailable notice,
 * the empty notice, or the content.
 *
 * An error is checked first, whatever `state` says, because a card that failed must not go on
 * showing a value.
 */
function WidgetCardBody({
  state,
  error,
  title,
  onRetry,
  skeleton,
  skeletonItems,
  empty,
  children,
}: {
  state: CardState;
  error: string | null;
  title: string;
  onRetry?: () => void;
  skeleton?: SkeletonShape;
  skeletonItems?: unknown;
  empty?: CardEmptyContent;
  children: ReactNode;
}) {
  // The rows this card will draw, by the rule the list and table bodies draw by. Medium until the
  // card has measured itself, as those bodies are.
  const tier = useCardTier() ?? "medium";
  const rows =
    skeletonItems === undefined ? undefined : rowsDrawn(tier, skeletonItems);
  if (error !== null) {
    return <CardError message={error} title={title} onRetry={onRetry} />;
  }
  switch (state) {
    case "loading":
      return <CardSkeleton shape={skeleton} rows={rows} />;
    case "unavailable":
      return <CardUnavailable />;
    case "empty":
      return <CardEmpty {...(empty ?? EMPTY_DEFAULT)} />;
    default:
      return <>{children}</>;
  }
}

/**
 * The card's header, drawn as one row.
 *
 * Its own component so `WidgetCard` above stays a description of the card's
 * STATES rather than of its markup -- which is the part an archetype author
 * reads.
 *
 * The icon sits on the RIGHT, where the Users and Roles stat cards beside this
 * one put theirs. It is optional and functional rather than decorative: an icon
 * on every card is noise.
 */
function WidgetCardHeader({
  titleId,
  title,
  description,
  icon,
  leading,
  quick,
  headerAction,
}: {
  titleId: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  leading?: ReactNode;
  quick?: ReactNode;
  headerAction?: ReactNode;
}) {
  return (
    <CardHeader
      // No rule under the header. The stat cards beside this one are a single
      // padded surface, and a divider is the difference between a card and a
      // panel.
      noBorder
      className="flex-row items-start gap-2 space-y-0 px-5 pb-0 pt-5"
    >
      {leading && <span className="-ml-2 shrink-0">{leading}</span>}
      <div className="min-w-0 flex-1">
        {/* One heading level for every card, under the page's h1, in the one title style of
            the card type ramp (14 px, semibold). Wrapped, not truncated: a clipped title is a
            card nobody can name. */}
        <h2
          id={titleId}
          className="break-words text-sm font-semibold leading-snug tracking-tight text-foreground"
        >
          {title}
        </h2>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {icon && (
        <span
          className="shrink-0 pt-0.5 text-muted-foreground"
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      {quick && <span className="shrink-0">{quick}</span>}
      {headerAction && <span className="shrink-0">{headerAction}</span>}
    </CardHeader>
  );
}

/**
 * The freshness line and the single footer link, or nothing at all.
 *
 * Both are already resolved by the time they arrive: an error state withholds
 * each of them, and that decision belongs with the card's other state rules
 * rather than being taken again here.
 */
function WidgetCardFooter({
  freshness,
  link,
  inert = false,
}: {
  freshness: Date | null;
  link?: { label: string; href: string };
  /** Customise mode: the footer's link is out of reach, like the body's. */
  inert?: boolean;
}) {
  // Before the early return, so the hook runs on every render of this
  // component whichever branch it takes.
  const relative = useRelativeTime(freshness);

  if (freshness === null && link === undefined) return null;

  return (
    <CardFooter
      data-testid="widget-card-footer"
      inert={inert || undefined}
      // No top rule and no tint. `CardFooter` defaults to both, which draws a
      // filled strip across the bottom and reads as a separate element attached
      // to the card rather than as part of it.
      className="flex items-center justify-between gap-2 border-0 bg-transparent px-5 pb-4 pt-0"
    >
      {freshness !== null ? (
        // A `<time>` carrying the machine-readable instant, with the exact one
        // on hover. The relative label is the scannable form and is deliberately
        // imprecise; a reader who needs to know whether "5m ago" means before or
        // after something else they were watching has nowhere else to find out,
        // and `dateTime` is what lets anything reading the page recover the
        // instant the prose rounded off.
        <time
          dateTime={freshness.toISOString()}
          title={formatDateWithAdminTimezone(
            freshness,
            { dateStyle: "medium", timeStyle: "medium" },
            ""
          )}
          data-testid="widget-card-freshness"
          className="text-xs text-muted-foreground"
        >
          Updated {relative}
        </time>
      ) : (
        // Holds the footer's left column so a link-only footer still sits
        // right, without a second layout branch.
        <span />
      )}
      {link !== undefined && (
        <Link
          href={link.href}
          className="text-xs font-medium text-primary hover:underline focus-visible:underline"
        >
          {link.label}
        </Link>
      )}
    </CardFooter>
  );
}
