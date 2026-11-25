"use client";

/**
 * The page's two cards: the source on one side and the language being written
 * on the other, a field's two halves always in line.
 *
 * Drawn row by row rather than as two boxes of their own: each row is one
 * field, its source first and its translation after it, so the two start at the
 * same height whatever each holds, and a keyboard meets them in that order.
 * The cells of one side together look like its card. Where there is no room for
 * two, each field is a card of its own, its source above its translation.
 *
 * With no source anywhere there is nothing to set beside, and one card.
 *
 * @module components/features/translations/page/TranslationCards
 */

import { createContext, useContext, type JSX, type ReactNode } from "react";

import { cn } from "@admin/lib/utils";

/** What every row of the cards reads. */
interface Cards {
  /** Whether there is a source to set beside: otherwise one card. */
  paired: boolean;
  /** The language the source card is headed with, by its code. */
  source: string;
}

const CardsContext = createContext<Cards>({ paired: true, source: "" });

export function useCards(): Cards {
  return useContext(CardsContext);
}

/** Two cells in line, where there is room for two. */
const PAIR = "@xl/cards:grid @xl/cards:grid-cols-2 @xl/cards:gap-x-4";

/** One side of a row, as part of that side's card. */
const CELL =
  "min-w-0 @xl/cards:border-x @xl/cards:border-border @xl/cards:bg-card @xl/cards:px-5";

/** A language's name at the head of its card, or of its half on a phone. */
const HEADING = "font-mono text-xs uppercase text-muted-foreground";

export interface TranslationCardsProps extends Cards {
  sourceLabel: string;
  targetLabel: string;
  children: ReactNode;
}

export function TranslationCards({
  paired,
  source,
  sourceLabel,
  targetLabel,
  children,
}: TranslationCardsProps): JSX.Element {
  const edge = (end: "head" | "foot", of?: string) => (
    <div
      className={cn(
        CELL,
        end === "head"
          ? "@xl/cards:rounded-t-lg @xl/cards:border-t @xl/cards:pt-4 @xl/cards:pb-1"
          : "@xl/cards:h-3 @xl/cards:rounded-b-lg @xl/cards:border-b"
      )}
    >
      {of === undefined ? null : <span className={HEADING}>{of}</span>}
    </div>
  );
  // Only drawn around two cards: a phone names the language in each half.
  const row = cn("hidden @xl/cards:block", paired && PAIR);
  return (
    <CardsContext.Provider value={{ paired, source }}>
      <div className="@container/cards">
        <div className={row} data-slot="translation-card-head">
          {paired ? edge("head", `${sourceLabel} (source)`) : null}
          {edge("head", targetLabel)}
        </div>
        {children}
        <div className={row} aria-hidden>
          {paired ? edge("foot") : null}
          {edge("foot")}
        </div>
      </div>
    </CardsContext.Provider>
  );
}

export interface CardRowProps {
  /** The source's half; absent for a field with no source. */
  source?: ReactNode;
  /** Who the source's half is in, named on a phone. */
  sourceLabel?: string | undefined;
  target: ReactNode;
  targetLabel: string;
}

/** One field: its source, and what is written from it. */
export function CardRow({
  source,
  sourceLabel,
  target,
  targetLabel,
}: CardRowProps): JSX.Element {
  const { paired } = useCards();
  return (
    <div
      className={cn(
        "mb-4 space-y-4 rounded-lg border border-border bg-card p-4",
        "@xl/cards:mb-0 @xl/cards:space-y-0 @xl/cards:rounded-none @xl/cards:border-0 @xl/cards:bg-transparent @xl/cards:p-0",
        paired && PAIR
      )}
    >
      {source === undefined ? (
        // Its card goes on past it, and it says nothing.
        paired ? (
          <div className={cn(CELL, "hidden @xl/cards:block")} aria-hidden />
        ) : null
      ) : (
        <div className={CELL} data-slot="translation-source">
          <p className={cn(HEADING, "mb-2 @xl/cards:hidden")}>
            {sourceLabel} (source)
          </p>
          <div className="relative @xl/cards:py-3">{source}</div>
        </div>
      )}
      <div className={CELL} data-slot="translation-target">
        <p className={cn(HEADING, "mb-2 @xl/cards:hidden")}>{targetLabel}</p>
        <div className="relative @xl/cards:py-3">{target}</div>
      </div>
    </div>
  );
}

/** What rows are called, in line across both cards: "Slide 2". */
export function CardHeading({
  id,
  depth,
  children,
  mark,
}: {
  id: string;
  /** How far inside its container it stands. */
  depth: number;
  children: ReactNode;
  /** A mark beside the name. */
  mark?: ReactNode;
}): JSX.Element {
  const { paired } = useCards();
  const name = cn(
    "text-sm",
    depth === 0 ? "font-semibold" : "font-medium text-muted-foreground"
  );
  return (
    <div className={cn("mb-2 @xl/cards:mb-0", paired && PAIR)}>
      {paired ? (
        <div className={cn(CELL, "hidden @xl/cards:block")} aria-hidden>
          <span className={cn(name, "block @xl/cards:pt-4")}>{children}</span>
        </div>
      ) : null}
      <div
        className={cn(CELL, "flex flex-wrap items-center gap-2 @xl/cards:pt-4")}
      >
        <span id={id} className={name}>
          {children}
        </span>
        {mark}
      </div>
    </div>
  );
}
