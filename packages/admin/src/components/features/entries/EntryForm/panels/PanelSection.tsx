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

import type { DOMAttributes, JSX, ReactNode } from "react";
import { useId } from "react";

import { cn } from "@admin/lib/utils";

export function PanelSection({
  title,
  titleHidden = false,
  collapsesWhenEmpty = false,
  focusTarget,
  flush = false,
  containedEvents,
  children,
}: {
  title: string;
  /** Says the heading only to assistive technology. */
  titleHidden?: boolean;
  /**
   * Leaves no section, heading included, while its content draws nothing:
   * for a plugin's section, which may apply to some documents and not
   * others and knows which only once it has read something. Hidden by the
   * browser as the content changes, so the section needs no state of its own.
   */
  collapsesWhenEmpty?: boolean;
  /**
   * Lets the section take focus from script, marked with the given data
   * attribute: for a section whose control goes away when it has done its
   * work, so focus lands on the section rather than the top of the page.
   */
  focusTarget?: `data-${string}`;
  /**
   * Drawn in the field column rather than the panel: no inset or rule of its
   * own, so it lines up with the title and the fields it sits above.
   */
  flush?: boolean;
  /**
   * Handlers spread onto the section element, for a plugin's section: what
   * it does in a form of its own stays there, and its controls do not submit
   * or reset the document's form. Absent, the section is drawn as ever.
   */
  containedEvents?: Pick<
    DOMAttributes<HTMLElement>,
    "onSubmit" | "onReset" | "onClickCapture" | "onKeyDownCapture"
  >;
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
        "outline-none",
        flush ? "pt-4" : "border-b border-border px-5 py-4 last:border-b-0",
        // A section handed focus shows it with the ring the editor's controls
        // use, drawn inside so the panel's edges do not clip it.
        focusTarget !== undefined &&
          "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        // `display: none`, so the empty section leaves the reading order too.
        collapsesWhenEmpty && "has-[>[data-panel-section-body]:empty]:hidden"
      )}
      {...focusable}
      {...containedEvents}
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
      {collapsesWhenEmpty ? (
        <div data-panel-section-body="">{children}</div>
      ) : (
        children
      )}
    </section>
  );
}
