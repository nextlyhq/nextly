"use client";

/**
 * One folding part of the Content panel: a heading (Collections, Singles) or
 * a sub-heading (a collection's `sidebarGroup`), and the links under it.
 *
 * The heading is a button that says whether its part is open
 * (`aria-expanded`) and which part it opens (`aria-controls`). A folded part
 * stays in the document, hidden, so the button always names an element that
 * exists, and its links leave the tab order with it.
 *
 * @module components/layout/sidebar/ContentFold
 */
import { useId, type JSX, type ReactNode } from "react";

import { ChevronDown } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import type { ContentFolds } from "./lib/content-folds";

interface ContentFoldProps {
  /** The key the fold is remembered under. */
  foldKey: string;
  label: string;
  /**
   * How many items the part lists for the search: `null` while its list is
   * still arriving, when no number is drawn rather than one that will change;
   * absent for a sub-heading, which shows none.
   */
  count?: number | null;
  /** A heading, or a sub-heading one step quieter. */
  level: "heading" | "group";
  folds: ContentFolds;
  children: ReactNode;
}

export function ContentFold({
  foldKey,
  label,
  count,
  level,
  folds,
  children,
}: ContentFoldProps): JSX.Element {
  const regionId = useId();
  const folded = folds.isFolded(foldKey);
  const heading = level === "heading";
  return (
    <div className={heading ? "space-y-1" : "space-y-0.5"}>
      <button
        type="button"
        aria-expanded={!folded}
        aria-controls={regionId}
        // Heard as "Collections, 4": its text alone runs the two together.
        // While the count is unknown it is named by its label alone.
        aria-label={
          count === undefined || count === null
            ? undefined
            : `${label}, ${count}`
        }
        onClick={() => folds.toggle(foldKey)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-3 text-left outline-none",
          "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          // The panel's group heading (the Settings and plugin panels draw
          // theirs the same way); a sub-heading is one step quieter.
          heading
            ? "h-10 text-xs font-bold uppercase tracking-wider text-sidebar-foreground lg:h-8"
            : "h-9 text-xs font-semibold text-muted-foreground lg:h-7"
        )}
      >
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "shrink-0 text-muted-foreground motion-safe:transition-transform",
            heading ? "h-3.5 w-3.5" : "h-3 w-3",
            folded && "-rotate-90"
          )}
        />
        <span className="min-w-0 truncate">{label}</span>
        {count === undefined ? null : (
          // The count's slot is held while the list arrives, so nothing
          // moves when the number lands in it.
          <span
            aria-hidden={count === null ? true : undefined}
            className="ml-auto min-w-[2ch] text-right font-medium tracking-normal tabular-nums text-muted-foreground"
          >
            {count}
          </span>
        )}
      </button>
      <div id={regionId} hidden={folded} className={heading ? "" : "pl-2"}>
        {children}
      </div>
    </div>
  );
}
