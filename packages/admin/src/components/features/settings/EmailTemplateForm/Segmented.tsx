"use client";

import type React from "react";

import { cn } from "@admin/lib/utils";

// ============================================================
// Small UI: segmented control
// ============================================================

export type SegOption<T extends string> = {
  value: T;
  label?: string;
  icon?: React.ReactNode;
  title?: string;
};

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    // The end segments paint their active fill to the outline's edge, so at a
    // nonzero --radius that fill would square off across the rounded corners.
    // Clipping to the rounded box keeps the fill inside the outline at every
    // radius, and is inert at --radius: 0.
    <div className="inline-flex items-center overflow-hidden rounded-md border border-input">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-label={o.title ?? o.label}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-7 items-center gap-1.5 px-2.5 text-xs transition-colors",
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:text-foreground"
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
