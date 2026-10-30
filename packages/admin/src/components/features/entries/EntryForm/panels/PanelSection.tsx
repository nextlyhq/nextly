"use client";

/**
 * One section of the document panel: a small heading, then what it says.
 *
 * Every section is a `section` named by its heading, so the panel reads as a
 * list of landmarks a screen reader can move between, in the order the panel
 * draws them. A section whose own content already carries a visible title
 * (the language panel's header) keeps its heading for that reading and draws
 * it only for assistive technology, so the title is not said twice on screen.
 *
 * @module components/features/entries/EntryForm/panels/PanelSection
 */

import type { JSX, ReactNode } from "react";
import { useId } from "react";

import { cn } from "@admin/lib/utils";

export function PanelSection({
  title,
  titleHidden = false,
  children,
}: {
  title: string;
  /** Says the heading only to assistive technology. */
  titleHidden?: boolean;
  children: ReactNode;
}): JSX.Element {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-panel-section={title}
      className="border-b border-border px-5 py-4 last:border-b-0"
    >
      <h3
        id={headingId}
        className={cn(
          "mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground",
          titleHidden && "sr-only"
        )}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}
