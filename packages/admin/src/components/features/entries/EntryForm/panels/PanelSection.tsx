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
  focusTarget,
  children,
}: {
  title: string;
  /** Says the heading only to assistive technology. */
  titleHidden?: boolean;
  /**
   * Lets the section take focus from script, marked with the given data
   * attribute: for a section whose control goes away when it has done its
   * work, so focus lands on the section rather than the top of the page.
   */
  focusTarget?: `data-${string}`;
  children: ReactNode;
}): JSX.Element {
  const headingId = useId();
  const focusable =
    focusTarget === undefined ? {} : { tabIndex: -1, [focusTarget]: "" };
  return (
    <section
      aria-labelledby={headingId}
      data-panel-section={title}
      className={cn(
        "border-b border-border px-5 py-4 outline-none last:border-b-0",
        // A section handed focus shows it with the ring the editor's controls
        // use, drawn inside so the panel's edges do not clip it.
        focusTarget !== undefined &&
          "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      )}
      {...focusable}
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
