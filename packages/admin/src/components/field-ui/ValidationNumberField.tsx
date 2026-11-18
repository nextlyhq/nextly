"use client";

import { Input, Label } from "@nextlyhq/ui";
import { useId, type JSX } from "react";

/**
 * @deprecated Use `FieldSettingsPanel` from `@nextlyhq/plugin-sdk/admin`
 *   instead. Removed no earlier than 0.0.2-alpha.75, and only once the Form
 *   Builder and user custom fields use the shared picker and panel.
 */
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
 *
 * @deprecated Use `FieldSettingsPanel` from `@nextlyhq/plugin-sdk/admin`
 *   instead. Removed no earlier than 0.0.2-alpha.75, and only once the Form
 *   Builder and user custom fields use the shared picker and panel.
 */
export function ValidationNumberField(
  props: ValidationNumberFieldProps
): JSX.Element {
  return <ValidationBoundField {...props} />;
}

/**
 * The bound as `ValidationRulesEditor` draws it: the same control, with why the
 * bound as it stands cannot be kept said under it and read with it.
 *
 * Kept apart from `ValidationNumberField` rather than added to its props: those
 * are published to plugins and frozen (`field-ui-compat.test-d.ts` in the
 * plugin SDK), so the problem is the editor's to say, which sees the bound's
 * pair. Not exported from the kit.
 */
export function ValidationBoundField({
  label,
  value,
  onChange,
  description,
  disabled,
  counts = false,
  placeholder,
  problem = null,
}: ValidationNumberFieldProps & {
  /** Why the bound cannot be kept, or `null` when it can. */
  problem?: string | null;
}): JSX.Element {
  const id = useId();
  const problemId = `${id}-problem`;
  const describedBy =
    [problem !== null && problemId, description && `${id}-description`]
      .filter(Boolean)
      .join(" ") || undefined;

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
        aria-invalid={problem !== null}
        aria-describedby={describedBy}
        onChange={event =>
          onChange(
            event.target.value === "" ? undefined : Number(event.target.value)
          )
        }
      />
      {/* An alert, as the panel's name problem is, so it is announced as it
          appears rather than only when the control is read again. In the
          error text colour the form messages use, which reads at 4.5:1 in
          both schemes. */}
      {problem !== null ? (
        <p id={problemId} role="alert" className="text-xs text-danger-text">
          {problem}
        </p>
      ) : null}
      {description ? (
        <p id={`${id}-description`} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}
