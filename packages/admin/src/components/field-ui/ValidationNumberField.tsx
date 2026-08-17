"use client";

import { Input, Label } from "@nextlyhq/ui";
import { useId } from "react";

export interface ValidationNumberFieldProps {
  /** Visible name of the rule, e.g. "Min length". */
  label: string;
  /** The rule's current bound, or `undefined` when it is not set. */
  value: number | undefined;
  /** Called with `undefined` when the field is cleared. */
  onChange: (value: number | undefined) => void;
  /** Help text under the control. */
  description?: string;
  disabled?: boolean;
  /**
   * The bound counts things — characters, rows, items — so it admits whole
   * numbers of zero or more. Leave it off for a bound on a VALUE, which may
   * legitimately be fractional or negative.
   */
  counts?: boolean;
  placeholder?: string;
}

/**
 * One numeric validation bound.
 *
 * Every surface that edits validation draws the same control, and the two that
 * did so independently disagreed about it: one coerced with `Number` and set no
 * limits, so a length of `2.7` or `-5` could be typed and persisted, while the
 * other used `parseInt` with a floor of zero. Those are different answers to
 * one question, and the divergence is invisible until a value nothing enforces
 * reaches the database.
 *
 * The empty field means "no bound" rather than zero, so clearing it yields
 * `undefined` and not `0` — a distinction the browser's own value cannot carry,
 * since an empty numeric input and a zero both read as falsy.
 *
 * The id is generated rather than derived from the label. A label-derived id is
 * document-global, so two editors open at once mint the same one and `htmlFor`
 * resolves to whichever control rendered first.
 */
export function ValidationNumberField({
  label,
  value,
  onChange,
  description,
  disabled,
  counts = false,
  placeholder,
}: ValidationNumberFieldProps) {
  const id = useId();
  const describedBy = description ? `${id}-description` : undefined;

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        step={counts ? 1 : undefined}
        min={counts ? 0 : undefined}
        placeholder={placeholder}
        value={value ?? ""}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={event =>
          onChange(
            event.target.value === "" ? undefined : Number(event.target.value)
          )
        }
      />
      {description ? (
        <p id={describedBy} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}
