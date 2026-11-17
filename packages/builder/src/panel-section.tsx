"use client";

/**
 * A section of the block panel, as every tab draws it: a fold header with the
 * section's name in bold, a dot beside it while it holds a value, and the
 * chevron, over the section's controls; sections divided by a line and each
 * folding on its own (`panel-folds`).
 *
 * @module panel-section
 */
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@nextlyhq/ui";
import * as React from "react";

import type { EditableProp } from "./inspector";
import { useTabFolds } from "./panel-folds-context";

/**
 * A section's header: its name, the dot when it holds a value, the chevron.
 *
 * The dot carries "has changes" for a screen reader, so it is never colour
 * alone, and it sits beside the name it qualifies, so it moves no control.
 */
export function SectionHeading({
  label,
  holdsValues,
}: {
  label: string;
  holdsValues: boolean;
}): React.JSX.Element {
  return (
    // The panel's own class sets the heading's height and turns the shared
    // chevron to point right while closed and down while open.
    <AccordionTrigger className="nx-style-inspector__section-trigger">
      <span className="nx-style-inspector__section-label">
        {label}
        {holdsValues ? (
          <span className="nx-style-inspector__section-dot" data-has-values="">
            <span aria-hidden="true" className="nx-style-inspector__dot" />
            <span className="nx-sr-only">has changes</span>
          </span>
        ) : null}
      </span>
    </AccordionTrigger>
  );
}

/** One section a tab draws: what it is called, and what it holds. */
export interface PanelSection {
  /** What the section is known by in the page: unique in its tab. */
  readonly key: string;
  readonly label: string;
  /** Whether it holds a value for what is being edited. */
  readonly holdsValue: boolean;
  readonly body: React.ReactNode;
}

/**
 * A tab's sections, each folding on its own and remembered by the tab and
 * the section's name.
 *
 * A closed section's controls stay mounted, only hidden: a field commits on
 * blur and some hold a draft, so taking them away with the fold would throw
 * away what an author typed.
 */
export function PanelSections({
  tab,
  sections,
}: {
  tab: string;
  sections: readonly PanelSection[];
}): React.JSX.Element {
  const { open, onOpenChange } = useTabFolds(tab, sections);
  return (
    <Accordion
      type="multiple"
      value={open}
      onValueChange={onOpenChange}
      className="nx-panel-sections"
    >
      {sections.map(section => (
        <AccordionItem
          key={section.key}
          value={section.key}
          data-section={section.key}
          className="nx-panel-section"
        >
          <SectionHeading
            label={section.label}
            holdsValues={section.holdsValue}
          />
          {/* Kept mounted but hidden while closed: forced present, the
              accordion would otherwise leave a closed section's controls
              on screen and in the Tab order. */}
          <AccordionContent
            forceMount
            hidden={!open.includes(section.key)}
            className="nx-panel-section__body"
          >
            {section.body}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

/** Whether any of a section's settings is stored on the block. */
export function rowsHoldValue(rows: readonly EditableProp[]): boolean {
  return rows.some(row => row.value !== undefined);
}
