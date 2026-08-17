"use client";

import type { ReactNode } from "react";
import { useId } from "react";

interface SettingsRowGroupProps {
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
}: SettingsRowGroupProps) {
  const labelId = useId();

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-4 md:gap-8 py-5 items-start"
    >
      <div className="flex flex-col">
        <span id={labelId} className="text-sm font-semibold text-foreground">
          {label}
        </span>
        {description && (
          <span className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
            {description}
          </span>
        )}
      </div>
      <div className="w-full">{children}</div>
    </div>
  );
}
