"use client";

/**
 * The header's live summary: what needs the reader, one link per part, joined
 * by " · ". A part follows to its card when the card is on the dashboard,
 * scrolled to and focused; otherwise it opens the list the card would.
 *
 * Nothing is drawn while the summary loads or when it could not be read, and
 * "You're all caught up" only when every part was read and none has anything.
 *
 * @module components/features/dashboard/header/SummaryLine
 */

import { Fragment, type JSX, type MouseEvent } from "react";

import { Link } from "@admin/components/ui/link";
import type { DashboardSummary } from "@admin/types/dashboard/summary";

import { CELL_PLACEMENT_ATTRIBUTE } from "../../widgets/edit/drag/useCardDrag";

import { summaryLine, type SummaryLinePart } from "./summary-wording";

const LINK_CLASS =
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
      onClick={toCard}
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
}: {
  summary: DashboardSummary | undefined;
  /** Each widget's card on the dashboard, by widget id. */
  cards: Readonly<Record<string, string>>;
  now: Date;
}): JSX.Element | null {
  if (summary === undefined) return null;
  const line = summaryLine(summary, now);
  if (line.kind === "none") return null;
  return (
    <p
      className="mt-[3px] text-[12.5px] text-muted-foreground"
      data-testid="dashboard-summary"
    >
      {line.kind === "caught-up"
        ? "You're all caught up"
        : line.parts.map((part, index) => (
            <Fragment key={part.key}>
              {index > 0 ? " · " : null}
              <PartLink part={part} card={cards[part.widget]} />
            </Fragment>
          ))}
    </p>
  );
}
