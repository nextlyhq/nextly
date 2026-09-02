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
 * The list is the server's `available`, narrowed by what the reader has added
 * or removed since — never re-derived from the registry here, because the
 * server is the only party that filters by permission authoritatively.
 *
 * @module components/features/widgets/edit/AddWidgetPicker
 */

import { Button } from "@nextlyhq/ui";

import * as Icons from "@admin/components/icons";

export interface AddWidgetOption {
  widgetId: string;
  title: string;
  category?: string;
}

export interface AddWidgetPickerProps {
  options: AddWidgetOption[];
  onAdd: (widgetId: string) => void;
}

export function AddWidgetPicker({ options, onAdd }: AddWidgetPickerProps) {
  if (options.length === 0) {
    // Said rather than rendered blank. An empty picker and a picker that failed
    // to load look identical, and "everything is already on your dashboard" is
    // the reassuring one of the two — so it is the one that gets written down.
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="add-widget-empty"
      >
        Every widget available to you is already on your dashboard.
      </p>
    );
  }

  return (
    <section aria-label="Add a widget" data-testid="add-widget-picker">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Add a widget
      </h3>
      <ul className="flex flex-wrap gap-2">
        {options.map(option => (
          <li key={option.widgetId}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onAdd(option.widgetId)}
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
