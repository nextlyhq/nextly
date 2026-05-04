"use client";

import type { ReactNode } from "react";

import { useFormField } from "@admin/components/ui/form";

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
 */
export function SettingsRow({
  label,
  description,
  children,
}: SettingsRowProps) {
  const { formItemId } = useFormField();

  return (
    <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-4 md:gap-8 py-5 items-start">
      <label htmlFor={formItemId} className="cursor-pointer flex flex-col">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        {description && (
          <span className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
            {description}
          </span>
        )}
      </label>
      <div className="w-full">{children}</div>
    </div>
  );
}
