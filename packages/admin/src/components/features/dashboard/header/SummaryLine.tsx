"use client";

/**
 * The header's live summary: what needs the reader, one link per part, joined
 * by " · ". A part follows to its card when the card is on the dashboard,
 * scrolled to and focused; otherwise it opens the list the card would. A
 * modified or non-primary click on a link is the browser's, as on any link.
 *
 * Nothing is drawn while the summary loads or when it could not be read, and
 * "You're all caught up" only when every part was read and none has anything.
 * What the header ends the line with (`trailing`, "Resume setup") is drawn
 * after the parts whatever the summary says, as it is not one of them.
 *
 * @module components/features/dashboard/header/SummaryLine
 */

import { Fragment, type JSX, type MouseEvent, type ReactNode } from "react";

import { Link, prefersNativeNavigation } from "@admin/components/ui/link";
import type { DashboardSummary } from "@admin/types/dashboard/summary";

// From its own import-free module, never from the drag code: this line is part of the first
// screen every page loads, and customise mode's drag loads with the dashboard route.
import { CELL_PLACEMENT_ATTRIBUTE } from "../../widgets/cell-placement-attribute";

import { summaryLine, type SummaryLinePart } from "./summary-wording";

/** How a part that can be pressed is drawn, and anything the line ends with. */
export const LINK_CLASS =
  "text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

/**
 * Scrolls to a card and focuses it, answering whether it was there. Smooth
 * only where motion is welcome.
 */
function focusCard(placementId: string | undefined): boolean {
  if (placementId === undefined) return false;
  const card = document.querySelector<HTMLElement>(
    `[${CELL_PLACEMENT_ATTRIBUTE}="${CSS.escape(placementId)}"]`
  );
  if (card === null) return false;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  card.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
  card.focus({ preventScroll: true });
  return true;
}

/**
 * The card a part follows to, when it is on the dashboard: the very card the
 * part names, else its widget's first.
 */
function cardOf(
  part: SummaryLinePart,
  cards: Readonly<Record<string, readonly string[]>>
): string | undefined {
  const placed = cards[part.widget] ?? [];
  if (part.card === undefined) return placed[0];
  return placed.includes(part.card) ? part.card : undefined;
}

function PartLink({
  part,
  card,
}: {
  part: SummaryLinePart;
  /** The part's card on the dashboard, when it is there. */
  card: string | undefined;
}): JSX.Element {
  const toCard = (event: MouseEvent) => {
    if (focusCard(card)) event.preventDefault();
  };
  // Opening the list in a new tab or window is the reader's to ask for: only
  // a plain primary click follows to the card instead.
  const linkToCard = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!prefersNativeNavigation(event, undefined)) toCard(event);
  };
  // With no list to open and no card to follow to, there is nowhere to go:
  // the part is words, not a control that does nothing.
  if (part.href === undefined && card === undefined) {
    return (
      <span
        className="text-foreground"
        data-testid={`dashboard-summary-${part.key}`}
      >
        {part.text}
      </span>
    );
  }
  return part.href === undefined ? (
    <button
      type="button"
      className={LINK_CLASS}
      onClick={toCard}
      data-testid={`dashboard-summary-${part.key}`}
    >
      {part.text}
    </button>
  ) : (
    <Link
      href={part.href}
      className={LINK_CLASS}
      onClick={linkToCard}
      data-testid={`dashboard-summary-${part.key}`}
    >
      {part.text}
    </Link>
  );
}

export function SummaryLine({
  summary,
  cards,
  now,
  trailing,
}: {
  summary: DashboardSummary | undefined;
  /** Each widget's cards on the dashboard, in its order, by widget id. */
  cards: Readonly<Record<string, readonly string[]>>;
  now: Date;
  /** Drawn at the line's end, after a " · " when the line has words before it. */
  trailing?: ReactNode;
}): JSX.Element | null {
  const line =
    summary === undefined
      ? ({ kind: "none" } as const)
      : summaryLine(summary, now);
  if (line.kind === "none" && trailing == null) return null;
  return (
    <p
      className="mt-[3px] text-[12.5px] text-muted-foreground"
      data-testid="dashboard-summary"
    >
      {line.kind === "none"
        ? null
        : line.kind === "caught-up"
          ? "You're all caught up"
          : line.parts.map((part, index) => (
              <Fragment key={part.key}>
                {index > 0 ? " · " : null}
                <PartLink part={part} card={cardOf(part, cards)} />
              </Fragment>
            ))}
      {trailing == null ? null : (
        <>
          {line.kind === "none" ? null : " · "}
          {trailing}
        </>
      )}
    </p>
  );
}
