"use client";

/**
 * The four states a card shows instead of its content, and the skeleton it shows first.
 *
 * Every card, core or plugin, draws these the same way: one wording, one look, one place an
 * action goes. A widget supplies data and a body; it never draws its own loading, empty,
 * unavailable or error state, which is what kept them differing card by card before.
 *
 * None of them is a live region. The dashboard announces through its one polite region, and a
 * card that announced its own error would talk over it (see `WidgetCard`).
 *
 * @module components/features/widgets/frame/states
 */

import { Button, Skeleton } from "@nextlyhq/ui";

import { Lock, RefreshCw, XCircle } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";

/** The kinds of body a skeleton can be shaped like, so it matches what will arrive. */
export type SkeletonShape =
  | "figure"
  | "rows"
  | "chart"
  | "bars"
  | "actions"
  | "text";

/**
 * A skeleton shaped like the body that has not arrived yet: a figure where a number will be,
 * rows where a list will be. A generic block would jump into a different shape when the data
 * lands, which is the layout shift this exists to avoid.
 */
export function CardSkeleton({
  shape = "rows",
  rows = 3,
}: {
  shape?: SkeletonShape;
  rows?: number;
}) {
  return (
    <div
      className="grid gap-2.5"
      data-testid="card-skeleton"
      data-shape={shape}
    >
      {/* Read when a reader reaches the card, not announced: the body is already
          `aria-busy`, and the grid's one live region announces the batch, so a
          status per card would speak once for every card loading at the same time. */}
      <span className="sr-only">Loading</span>
      {shape === "figure" && (
        <>
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-3.5 w-1/2" />
        </>
      )}
      {shape === "chart" && <Skeleton className="h-32 w-full" />}
      {shape === "actions" && (
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      )}
      {(shape === "rows" || shape === "bars" || shape === "text") &&
        Array.from({ length: rows }, (_, i) => (
          <Skeleton
            key={i}
            className={
              shape === "bars"
                ? "h-4 w-full"
                : i % 3 === 1
                  ? "h-3.5 w-4/5"
                  : i % 3 === 2
                    ? "h-3.5 w-3/5"
                    : "h-3.5 w-full"
            }
          />
        ))}
    </div>
  );
}

/** What an empty card says, and the one thing the person may do about it. */
export interface CardEmptyContent {
  /** What will appear here: "No posts yet". */
  title: string;
  /** One line on what fills it: "Your newest posts show here." */
  detail?: string;
  /**
   * At most ONE action, and only one the person may take. The caller decides that; the frame
   * draws what it is given and never a second button.
   */
  action?: { label: string; href: string };
}

export function CardEmpty({ title, detail, action }: CardEmptyContent) {
  return (
    <div className="grid justify-items-start gap-1" data-testid="card-empty">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      {action && (
        <Link
          href={action.href}
          className="mt-2 inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-primary/5"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

/**
 * The one "not available" state. It reads the same, word for word, whether the card's source
 * is forbidden to this person, no longer exists, or is a collection kept off the dashboard: a
 * different message for "forbidden" would tell a person that the thing they cannot see exists.
 */
export const UNAVAILABLE_TITLE = "Not available to you";
export const UNAVAILABLE_DETAIL =
  "What this card shows isn't available to your account.";

export function CardUnavailable() {
  return (
    <div
      className="grid justify-items-start gap-1"
      data-testid="card-unavailable"
    >
      <Lock className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-semibold text-foreground">
        {UNAVAILABLE_TITLE}
      </p>
      <p className="text-xs text-muted-foreground">{UNAVAILABLE_DETAIL}</p>
    </div>
  );
}

/**
 * A card whose data failed to load. It keeps the card's title (the frame draws it), says what
 * happened, and offers Retry for this card only when the caller can retry it.
 */
export function CardError({
  message,
  title,
  onRetry,
}: {
  message: string;
  /** The card's title, for Retry's accessible name. */
  title: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="grid justify-items-start gap-1"
      data-testid="widget-card-error"
    >
      <XCircle className="mb-1 h-5 w-5 text-destructive" aria-hidden="true" />
      {/* A string expression rather than JSX text, so the apostrophe is written as itself. */}
      <p className="text-sm font-semibold text-foreground">
        {"This card couldn't load"}
      </p>
      <p className="text-xs text-muted-foreground">{message}</p>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={onRetry}
          aria-label={`Retry ${title}`}
          data-testid="card-retry"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </Button>
      )}
    </div>
  );
}
