"use client";

import { Input } from "@nextlyhq/ui";
import { useId } from "react";

import { cn } from "@admin/lib/utils";

/**
 * A pair of inputs bounding a range, each with a REAL label rather than a
 * placeholder.
 *
 * The distinction is not stylistic. A `placeholder` on `<input type="date">` is
 * never rendered — the control paints its own format hint (`dd/mm/yyyy`) and
 * ignores the attribute entirely — so a date range written that way shows two
 * identical boxes with nothing saying which end is which. Measured in a browser:
 * `placeholder="From"` and `placeholder="To"` on adjacent date inputs render
 * indistinguishably, while the same placeholders on `text` and `number` inputs
 * render fine. That is why the bug hid: it is invisible in the spelling and only
 * appears for one input type.
 *
 * Labels are used for every type rather than only for dates. Two reasons, and
 * the second is the one that matters:
 *
 * - a placeholder disappears the moment a value is typed, so it labels an empty
 *   field and nothing else;
 * - the input type here is chosen by the field the user picked, so labelling
 *   only dates would make the row change height when they switch fields.
 */
export interface RangeFieldProps {
  /** Names the pair for assistive technology, e.g. "Created date". */
  label: string;
  type?: "date" | "number" | "text";
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  /** Wording for the two ends, where "From"/"To" does not read naturally. */
  fromLabel?: string;
  toLabel?: string;
  disabled?: boolean;
  /**
   * `row` places the two inputs side by side, `column` stacks them. A narrow
   * container — a filter menu — has no room for two date inputs in a row.
   */
  orientation?: "row" | "column";
  className?: string;
}

export function RangeField({
  label,
  type = "text",
  from,
  to,
  onFromChange,
  onToChange,
  fromLabel = "From",
  toLabel = "To",
  disabled = false,
  orientation = "row",
  className,
}: RangeFieldProps) {
  // Generated rather than derived from `label`, because two ranges can share a
  // label in different parts of a page and duplicate ids would point every
  // label at the first input.
  const id = useId();
  const fromId = `${id}-from`;
  const toId = `${id}-to`;

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "grid gap-2",
        orientation === "row" ? "grid-cols-2" : "grid-cols-1",
        className
      )}
    >
      <div className="space-y-1">
        <label
          htmlFor={fromId}
          className="block text-xs font-medium text-muted-foreground"
        >
          {fromLabel}
        </label>
        <Input
          id={fromId}
          type={type}
          value={from}
          disabled={disabled}
          onChange={event => onFromChange(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <label
          htmlFor={toId}
          className="block text-xs font-medium text-muted-foreground"
        >
          {toLabel}
        </label>
        <Input
          id={toId}
          type={type}
          value={to}
          disabled={disabled}
          onChange={event => onToChange(event.target.value)}
        />
      </div>
    </div>
  );
}
