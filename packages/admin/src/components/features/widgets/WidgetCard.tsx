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
import { formatRelativeTime } from "@admin/lib/dashboard";
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
  // A broken card offers no "view all": the destination is the thing that just
  // failed to answer, so the link is an invitation into the same failure.
  const showLink = link !== undefined && error === null;
  const showFooter = showLink || updatedAt !== null;

  return (
    <Card
      // `region` + the title as its name is what lets a screen-reader user jump
      // between widgets and know which one they landed on. Without the name a
      // region is worse than no landmark at all.
      role="region"
      aria-labelledby={titleId}
      className={cn("flex h-full flex-col", className)}
    >
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        {icon && (
          <span className="shrink-0 text-muted-foreground" aria-hidden="true">
            {icon}
          </span>
        )}
        <CardTitle
          id={titleId}
          className="min-w-0 flex-1 truncate text-sm font-semibold"
        >
          {title}
        </CardTitle>
        {headerAction && <span className="shrink-0">{headerAction}</span>}
      </CardHeader>

      <CardContent
        data-testid="widget-card-body"
        // Explicitly `false` rather than absent when idle: a reader that saw
        // `aria-busy="true"` needs the attribute to change back, and an omitted
        // attribute is a weaker signal than one that says "no longer busy".
        aria-busy={isLoading}
        className={cn(
          "flex flex-1 flex-col justify-center p-4",
          isLoading && "opacity-60 transition-opacity"
        )}
      >
        {error !== null ? (
          <p
            role="alert"
            className="text-sm text-destructive"
            data-testid="widget-card-error"
          >
            {error}
          </p>
        ) : (
          children
        )}
      </CardContent>

      {showFooter && (
        <CardFooter
          data-testid="widget-card-footer"
          className="flex items-center justify-between gap-2 border-t border-border px-4 py-2"
        >
          {updatedAt !== null ? (
            <span
              data-testid="widget-card-freshness"
              className="text-xs text-muted-foreground"
            >
              Updated {formatRelativeTime(updatedAt.toISOString())}
            </span>
          ) : (
            // Holds the footer's left column so a link-only footer still sits
            // right, without a second layout branch.
            <span />
          )}
          {showLink && (
            <Link
              href={link.href}
              className="text-xs font-medium text-primary hover:underline focus-visible:underline"
            >
              {link.label}
            </Link>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
