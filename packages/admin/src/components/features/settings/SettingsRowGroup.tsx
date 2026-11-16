"use client";

import { FieldRow } from "@nextlyhq/ui";
import type { JSX, ReactNode } from "react";
import { useId } from "react";

export interface SettingsRowGroupProps {
  label: string;
  description?: ReactNode;
  children: ReactNode;
}

/**
 * One row inside a SettingsSection whose control is a GROUP of several
 * independently-focusable elements — a switch plus a conditional grid of
 * checkboxes, an alert plus a dynamic list of name/value inputs — rather
 * than one control an id can attach to.
 *
 * `SettingsRow` points a `<label for>` at a single control resolved through
 * `useFormField`/`FormControl`. Neither exists here, and even where an id
 * did resolve, a `label for` naming one item of the group would misdescribe
 * the rest of it. `role="group"` with `aria-labelledby` names the whole
 * group instead, which is the relationship a set of controls actually has
 * to its heading.
 */
export function SettingsRowGroup({
  label,
  description,
  children,
}: SettingsRowGroupProps): JSX.Element {
  const labelId = useId();

  return (
    // The two-column grid is `FieldRow`'s, the one `SettingsRow` and the
    // plugin-facing `FieldShell` row layout draw too, so the three cannot drift
    // apart. No vertical padding here, deliberately: `FormSection` applies the
    // rhythm to every direct child through `--nx-field-gap`, and a group that
    // also padded itself would render at double the gap.
    <FieldRow
      role="group"
      aria-labelledby={labelId}
      aside={
        <>
          <span id={labelId} className="text-sm font-semibold text-foreground">
            {label}
          </span>
          {description && (
            <span className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
              {description}
            </span>
          )}
        </>
      }
    >
      {children}
    </FieldRow>
  );
}
