"use client";

/**
 * The widgets a reader may add, and the reason this exists at all.
 *
 * A newly installed plugin's card is never inserted into somebody's arrangement
 * behind their back — that is a decision, and it matches every full-snapshot
 * system in the prior art. But "not auto-added" only works if it is ADDABLE,
 * and without a list naming the unplaced widgets the card was reachable from
 * nothing: absent from every read, absent from the snapshot the next write
 * persisted, with no way for the reader to learn it existed.
 *
 * The list is what the server says this reader may see and add, narrowed by
 * what the reader has added since — never re-derived from the registry here,
 * because the server is the only party that filters by permission
 * authoritatively.
 *
 * Cards the reader REMOVED are listed first, under their own heading: putting
 * one back restores that card where it was, with its width and settings,
 * rather than adding a fresh one at the end.
 *
 * @module components/features/widgets/edit/AddWidgetPicker
 */

import { Button } from "@nextlyhq/ui";
import type { RefObject } from "react";

import * as Icons from "@admin/components/icons";

export interface AddWidgetOption {
  widgetId: string;
  title: string;
  category?: string;
}

/** A card the reader removed, which putting back restores in place. */
export interface RemovedCardOption {
  placementId: string;
  title: string;
}

export interface AddWidgetPickerProps {
  options: AddWidgetOption[];
  onAdd: (widgetId: string) => void;
  /** Cards removed from the draft, listed first. */
  removed?: RemovedCardOption[];
  onRestore?: (placementId: string, title: string) => void;
  /**
   * The picker's own region, where focus lands when the last card on the
   * dashboard is removed and no other card is left to take it.
   */
  sectionRef?: RefObject<HTMLElement | null>;
  /**
   * Whether the arrangement already holds as many cards as one write may carry.
   *
   * The picker still LISTS the surplus — those widgets exist and the reader
   * should be able to see that they do — but every button is disabled and the
   * reason is stated. Hiding them instead would make a widget disappear from
   * the one place it is discoverable, which is the defect this picker exists to
   * prevent.
   */
  atCapacity?: boolean;
}

/** The removed cards, each a button that puts that card back. */
function RemovedCards({
  removed,
  onRestore,
}: {
  removed: RemovedCardOption[];
  onRestore: (placementId: string, title: string) => void;
}) {
  if (removed.length === 0) return null;
  return (
    <>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Removed from your dashboard
      </h3>
      <ul className="mb-4 flex flex-wrap gap-2">
        {removed.map(card => (
          <li key={card.placementId}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onRestore(card.placementId, card.title)}
              // Says it is the SAME card coming back, not a new one: a reader
              // choosing between this and the same widget below needs to know
              // which keeps their settings.
              aria-label={`Put back ${card.title} where it was`}
              data-testid={`restore-card-${card.placementId}`}
            >
              <Icons.Plus aria-hidden className="mr-1.5 size-3.5" />
              {card.title}
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function AddWidgetPicker({
  options,
  onAdd,
  removed = [],
  onRestore,
  sectionRef,
  atCapacity = false,
}: AddWidgetPickerProps) {
  if (options.length === 0 && removed.length === 0) {
    // Said rather than rendered blank. An empty picker and a picker that failed
    // to load look identical, and "everything is already on your dashboard" is
    // the reassuring one of the two — so it is the one that gets written down.
    return (
      <p
        // A callback rather than the ref itself: the region's ref is typed for
        // any element, and this one is a paragraph.
        ref={element => {
          if (sectionRef) sectionRef.current = element;
        }}
        tabIndex={-1}
        className="text-sm text-muted-foreground"
        data-testid="add-widget-empty"
      >
        Every widget available to you is already on your dashboard.
      </p>
    );
  }

  return (
    <section
      ref={sectionRef}
      // Focusable only PROGRAMMATICALLY, as a landing place for focus.
      tabIndex={-1}
      aria-label="Add a widget"
      data-testid="add-widget-picker"
    >
      {onRestore ? (
        <RemovedCards removed={removed} onRestore={onRestore} />
      ) : null}
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Add a widget
      </h3>
      {atCapacity ? (
        // Named BEFORE the buttons, so a reader meets the reason rather than a
        // row of controls that do nothing. Removed cards are named in it
        // because they count: they stay in the list so they can be put back.
        <p
          className="mb-2 text-sm text-muted-foreground"
          data-testid="add-widget-at-capacity"
        >
          Your dashboard is full: it holds as many cards as it can, removed ones
          included. Put back a removed card instead.
        </p>
      ) : null}
      {options.length === 0 ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="add-widget-empty"
        >
          Every widget available to you is already on your dashboard.
        </p>
      ) : null}
      <ul className="flex flex-wrap gap-2">
        {options.map(option => (
          <li key={option.widgetId}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onAdd(option.widgetId)}
              disabled={atCapacity}
              // The category rides in the accessible name rather than being
              // rendered as a separate grouping. With a handful of widgets a
              // grouped list is more chrome than help, and a reader who needs
              // the distinction still hears it.
              aria-label={
                option.category
                  ? `Add ${option.title} (${option.category})`
                  : `Add ${option.title}`
              }
              data-testid={`add-widget-${option.widgetId}`}
            >
              <Icons.Plus aria-hidden className="mr-1.5 size-3.5" />
              {option.title}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
