/**
 * The small parts a list row is built from, beyond its text: a leading chip and a status pill.
 *
 * One look for each, so every list card's rows read alike: the chip is a square of the muted
 * surface holding a letter or a number (a collection's initial, a date), and the pill is a
 * rounded label whose tone says whether a status is done, waiting on someone, or failed.
 * Colours come from the theme's tokens, each with its dark-mode counterpart.
 *
 * @module components/features/widgets/frame/row-parts
 */

import type { JSX, ReactNode } from "react";

import { cn } from "@admin/lib/utils";

/**
 * What a status means to the reader: nothing to act on, done, waiting on someone, or failed.
 */
export type StatusTone = "neutral" | "good" | "warn" | "bad";

const TONE_CLASS: Readonly<Record<StatusTone, string>> = {
  neutral: "bg-muted text-foreground",
  good: "bg-success-surface text-success-text",
  warn: "bg-warning-surface text-warning-text",
  bad: "bg-danger-surface text-danger-text",
};

/** A status as a row's trailing slot draws it: a rounded label in its tone. */
export function StatusPill({
  tone = "neutral",
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}): JSX.Element {
  return (
    <span
      data-testid="status-pill"
      data-tone={tone}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 text-[11px] font-medium leading-4",
        TONE_CLASS[tone]
      )}
    >
      {children}
    </span>
  );
}

/**
 * A row's leading chip: a letter or a number on the muted surface, filling the row's leading
 * slot. Decorative, since the row's text already says what it stands for.
 */
export function LeadingChip({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="flex size-full items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground"
    >
      {children}
    </span>
  );
}
