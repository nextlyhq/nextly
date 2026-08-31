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

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@nextlyhq/ui";
import { useId, type ReactNode } from "react";

import { Link } from "@admin/components/ui/link";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { useRelativeTime } from "@admin/hooks/useRelativeTime";
import { cn } from "@admin/lib/utils";

export interface WidgetCardProps {
  /** Always rendered, in every state. */
  title: string;
  /** Optional, and functional rather than decorative — an icon per card is noise. */
  icon?: ReactNode;
  /** Room for the overflow menu the next slice adds. */
  headerAction?: ReactNode;
  /** Marks the body busy. Does not replace it. */
  isLoading?: boolean;
  /** Replaces the body. The title stays. */
  error?: string | null;
  /** When this widget's data landed, for the footer's freshness line. */
  updatedAt?: Date | null;
  /** At most ONE. A footer is not a row of buttons. */
  link?: { label: string; href: string };
  /** The archetype's rendering, or the plugin's component. */
  children: ReactNode;
  className?: string;
}

export function WidgetCard({
  title,
  icon,
  headerAction,
  isLoading = false,
  error = null,
  updatedAt = null,
  link,
  children,
  className,
}: WidgetCardProps) {
  const titleId = useId();
  // What a card in an error state withholds, decided once.
  //
  // It offers no "view all": the destination is the thing that just failed to
  // answer, so the link is an invitation into the same failure. And it claims
  // no freshness: the timestamp is when the BATCH landed, which is true of the
  // request and not of this card -- "Updated just now" printed under "Source
  // unavailable." tells the reader the opposite of what happened.
  //
  // Here rather than at each caller, so an archetype added later inherits both
  // rather than having to remember them.
  const settled = error === null;

  return (
    <Card
      // `region` + the title as its name is what lets a screen-reader user jump
      // between widgets and know which one they landed on. Without the name a
      // region is worse than no landmark at all.
      role="region"
      aria-labelledby={titleId}
      className={cn("flex h-full flex-col", className)}
    >
      <WidgetCardHeader
        titleId={titleId}
        title={title}
        icon={icon}
        headerAction={headerAction}
      />

      <CardContent
        data-testid="widget-card-body"
        // Explicitly `false` rather than absent when idle: a reader that saw
        // `aria-busy="true"` needs the attribute to change back, and an omitted
        // attribute is a weaker signal than one that says "no longer busy".
        aria-busy={isLoading}
        className={cn(
          // Top-aligned, not centred. Cards in a grid row stretch to the
          // tallest of them, so centring floats a one-line figure in the middle
          // of whatever the tallest card in that row happens to be -- while the
          // stat cards beside it keep their number directly under its label.
          "flex flex-1 flex-col justify-start px-5 pb-5 pt-2",
          isLoading && "opacity-60 transition-opacity"
        )}
      >
        {error !== null ? (
          <p
            className="text-sm text-destructive"
            data-testid="widget-card-error"
          >
            {error}
          </p>
        ) : (
          children
        )}
      </CardContent>

      <WidgetCardFooter
        freshness={settled ? updatedAt : null}
        link={settled ? link : undefined}
      />
    </Card>
  );
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
  icon,
  headerAction,
}: {
  titleId: string;
  title: string;
  icon?: ReactNode;
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
      <CardTitle
        id={titleId}
        className="min-w-0 flex-1 truncate text-xs font-semibold tracking-tight text-muted-foreground"
      >
        {title}
      </CardTitle>
      {icon && (
        <span
          className="shrink-0 pt-0.5 text-muted-foreground"
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
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
}: {
  freshness: Date | null;
  link?: { label: string; href: string };
}) {
  // Before the early return, so the hook runs on every render of this
  // component whichever branch it takes.
  const relative = useRelativeTime(freshness);

  if (freshness === null && link === undefined) return null;

  return (
    <CardFooter
      data-testid="widget-card-footer"
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
