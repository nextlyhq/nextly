"use client";

import type { ReactNode } from "react";

import { FormDescription, useFormField } from "@admin/components/ui/form";
import { useLabelLandingCheck } from "@admin/lib/forms/label-landing";

interface SettingsRowProps {
  label: string;
  description?: ReactNode;
  children: ReactNode;
}

/**
 * One row inside a SettingsSection.
 * Two-column grid: label + help on the left, control on the right.
 * Uses the form-field id linkage from useFormField so the <label> targets
 * the input rendered through FormControl.
 *
 * The `<label for>` is emitted unconditionally, while whether anything claims
 * that id depends entirely on what the caller passes as `children` — nothing
 * here can require a `FormControl`, and a `FormControl` wrapping a positioning
 * `<div>` puts the id on the div rather than on the control inside it. Both
 * shapes render and read as finished, which is how three of these shipped. The
 * landing check below turns that silence into a development warning.
 */
export function SettingsRow({
  label,
  description,
  children,
}: SettingsRowProps) {
  const { formItemId } = useFormField();

  useLabelLandingCheck({
    targetId: formItemId,
    label,
    remedies: {
      absent:
        "Wrap the control in <FormControl> so it receives the id, or — if this row " +
        "holds a GROUP of controls rather than one — use <SettingsRowGroup>, which " +
        "names the whole group with role=group and aria-labelledby instead.",
      notLabelable:
        "<FormControl> clones onto its single child, so a wrapper element around the " +
        "control absorbs the id. Put <FormControl> directly on the focusable control " +
        "and move the wrapper outside it.",
    },
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-4 md:gap-8 py-5 items-start">
      <div className="flex flex-col">
        <label
          htmlFor={formItemId}
          className="cursor-pointer text-sm font-semibold text-foreground"
        >
          {label}
        </label>
        {/* A sibling of the label rather than a child of it, and rendered
            through FormDescription rather than as plain markup. Inside the
            label, help text became part of the control's accessible NAME — a
            screen reader announced the whole paragraph every time focus
            arrived — and nothing registered it with FormControl, so it reached
            aria-describedby not at all. FormDescription publishes its presence,
            which is what lets FormControl name it. */}
        {description && (
          <FormDescription className="mt-0.5 text-xs leading-relaxed">
            {description}
          </FormDescription>
        )}
      </div>
      <div className="w-full">{children}</div>
    </div>
  );
}
