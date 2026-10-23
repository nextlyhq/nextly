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
import { cn } from "@admin/lib/utils";

import {
  FIGURE_VALUE_CLASS,
  LIST_CLASS,
  LIST_DETAIL_CLASS,
  LIST_LABEL_CLASS,
  LIST_ROW_CLASS,
  MORE_LINE_CLASS,
  ROWS_STACK_CLASS,
  STATS_CELL_CLASS,
  STATS_GRID_CLASS,
  STATS_LABEL_CLASS,
  TABLE_CELL_CLASS,
  TABLE_CLASS,
  TABLE_HEAD_ROW_CLASS,
  TABLE_HEADING_CLASS,
  TABLE_ROW_CLASS,
} from "./geometry";
import type { RowsLayout } from "./tier";

/** The kinds of body a skeleton can be shaped like, so it matches what will arrive. */
export type SkeletonShape =
  | "figure"
  | "stats"
  | "rows"
  | "chart"
  | "bars"
  | "actions"
  | "text";

/**
 * One line of a skeleton, as tall as a line of `lineClass` and no taller: the bar is `1em` of
 * the line's own type, set at the top of a line box the line's own leading decides.
 */
function SkeletonLine({
  lineClass,
  width,
}: {
  lineClass: string;
  width: string;
}) {
  return (
    <div className={lineClass}>
      <Skeleton className={cn("inline-block h-[1em] align-top", width)} />
    </div>
  );
}

/**
 * The rows a list or table card will draw, in the same line boxes and gaps (`frame/geometry`),
 * and the "More exist" line under them.
 *
 * The line is ALWAYS held. Whether more exist is only known from the answer, and holding it
 * makes the only change an answer can bring a shrink: a list that has fewer rows than were held,
 * or no more beyond them, closes up once, and nothing on the dashboard is ever pushed down.
 */
function SkeletonRows({ rows, layout }: { rows: number; layout: RowsLayout }) {
  const widths = ["w-full", "w-4/5", "w-3/5"];
  return (
    <div className={ROWS_STACK_CLASS}>
      {layout.kind === "table" ? (
        <table className={TABLE_CLASS}>
          <thead>
            <tr className={TABLE_HEAD_ROW_CLASS}>
              {Array.from({ length: layout.columns }, (_, c) => (
                <th key={c} className={TABLE_HEADING_CLASS}>
                  <Skeleton className="inline-block h-[1em] w-1/2 align-top" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r} className={TABLE_ROW_CLASS}>
                {Array.from({ length: layout.columns }, (_, c) => (
                  <td key={c} className={TABLE_CELL_CLASS}>
                    <Skeleton
                      className={cn(
                        "inline-block h-[1em] align-top",
                        widths[(r + c) % 3]
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className={LIST_CLASS}>
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} className={LIST_ROW_CLASS}>
              <SkeletonLine
                lineClass={LIST_LABEL_CLASS}
                width={widths[r % 3]}
              />
              {layout.kind === "list-detail" && (
                <SkeletonLine lineClass={LIST_DETAIL_CLASS} width="w-2/5" />
              )}
            </div>
          ))}
        </div>
      )}
      <SkeletonLine lineClass={MORE_LINE_CLASS} width="w-20" />
    </div>
  );
}

/**
 * A stats card's cells, each its value's line (held) above its label, in the very grid the
 * loaded cells are drawn in. The labels are the declaration's own, so a label that wraps wraps
 * here too, and the cells fall into the same rows.
 */
function SkeletonStats({ cells }: { cells: readonly string[] }) {
  return (
    <dl className={STATS_GRID_CLASS}>
      {cells.map((label, index) => (
        <div key={index} className={STATS_CELL_CLASS}>
          <dd>
            <span className={FIGURE_VALUE_CLASS}>
              <Skeleton className="inline-block h-[1em] w-12 align-top" />
            </span>
          </dd>
          <dt
            className={cn(
              STATS_LABEL_CLASS,
              "font-medium text-muted-foreground"
            )}
          >
            {label}
          </dt>
        </div>
      ))}
    </dl>
  );
}

/**
 * A skeleton shaped like the body that has not arrived yet: a figure where a number will be,
 * rows where a list will be. A generic block would jump into a different shape when the data
 * lands, which is the layout shift this exists to avoid.
 *
 * A figure and rows are drawn in the very line boxes the loaded body uses (`frame/geometry`), so
 * the answer arrives at the skeleton's own height. `layout` says how a rows skeleton is laid
 * out; absent, rows are drawn as plain lines.
 */
export function CardSkeleton({
  shape = "rows",
  rows = 3,
  layout,
  cells = [],
}: {
  shape?: SkeletonShape;
  rows?: number;
  layout?: RowsLayout;
  /** A stats card's cell labels, which are known before any of its numbers. */
  cells?: readonly string[];
}) {
  if (shape === "stats") {
    return (
      <div data-testid="card-skeleton" data-shape={shape}>
        <span className="sr-only">Loading</span>
        <SkeletonStats cells={cells} />
      </div>
    );
  }
  if ((shape === "rows" && layout) || shape === "figure") {
    return (
      <div data-testid="card-skeleton" data-shape={shape}>
        {/* Read when a reader reaches the card, not announced: the body is already
            `aria-busy`, and the grid's one live region announces the batch, so a
            status per card would speak once for every card loading at the same time. */}
        <span className="sr-only">Loading</span>
        {shape === "figure" ? (
          <SkeletonLine lineClass={FIGURE_VALUE_CLASS} width="w-1/3" />
        ) : (
          <SkeletonRows rows={rows} layout={layout ?? { kind: "list" }} />
        )}
      </div>
    );
  }
  return (
    <div
      className="grid gap-2.5"
      data-testid="card-skeleton"
      data-shape={shape}
    >
      <span className="sr-only">Loading</span>
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

/** The frame's own empty state, for a card whose body says nothing more particular. */
export const EMPTY_DEFAULT: CardEmptyContent = { title: "Nothing to show yet" };

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
