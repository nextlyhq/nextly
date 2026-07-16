"use client";

import { narrowFieldTypeCatalog } from "nextly/field-catalog";
import type { FieldTypeCatalogEntry } from "nextly/field-catalog";
import type React from "react";
import { useMemo } from "react";

import * as Icons from "@admin/components/icons";
import { Check, Type } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

/**
 * The catalog's `FieldType` union, re-derived here so the picker can be
 * generic over any surface's subset without importing server types.
 */
type CatalogFieldType = FieldTypeCatalogEntry["type"];

export interface FieldTypePickerProps<T extends CatalogFieldType> {
  /** The surface's allowed types; entries render in catalog order. */
  types: readonly T[];
  /** The selected type. */
  value: T;
  /** Called with the newly selected type. */
  onChange: (type: T) => void;
  /** Disable every card (read-only surfaces, locked identity in edit). */
  disabled?: boolean;
  /** Grid columns; surfaces with wider layouts pass more. */
  columns?: 2 | 3 | 4;
  /** Accessible name for the radio group. */
  ariaLabel?: string;
}

/**
 * Catalog-driven field-type picker: a grid of cards, one per allowed type,
 * rendered from `nextly/field-catalog` so every surface shows the same
 * label, hint, and icon for the same type. Controlled and form-library
 * agnostic — wrap it in react-hook-form or plain state alike.
 */
export function FieldTypePicker<T extends CatalogFieldType>({
  types,
  value,
  onChange,
  disabled,
  columns = 2,
  ariaLabel = "Field type",
}: FieldTypePickerProps<T>) {
  const entries = useMemo(() => narrowFieldTypeCatalog(types), [types]);

  const gridColumns = {
    2: "grid-cols-2",
    3: "grid-cols-2 md:grid-cols-3",
    4: "grid-cols-2 md:grid-cols-4",
  }[columns];

  // Standard radio-group keyboard model: the group is one tab stop (the
  // selected card), and arrow keys move + select within it.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled || entries.length === 0) return;
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !backward) return;
    event.preventDefault();
    const currentIndex = Math.max(
      0,
      entries.findIndex(entry => entry.type === value)
    );
    const nextIndex =
      (currentIndex + (forward ? 1 : -1) + entries.length) % entries.length;
    const nextType = entries[nextIndex].type;
    onChange(nextType);
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-type="${nextType}"]`)
      ?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("grid gap-3", gridColumns)}
      onKeyDown={handleKeyDown}
    >
      {entries.map(entry => {
        const Icon =
          (Icons as Record<string, React.ElementType>)[entry.icon] ?? Type;
        const isSelected = value === entry.type;
        return (
          <button
            key={entry.type}
            type="button"
            role="radio"
            data-type={entry.type}
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(entry.type)}
            className={cn(
              "relative flex flex-row items-center gap-4 rounded-none border p-4 text-left transition-all duration-200",
              isSelected
                ? "border-primary bg-primary/5"
                : "border-border hover-unified",
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            )}
          >
            {isSelected && (
              <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-none bg-primary text-primary-foreground">
                <Check className="h-3 w-3" />
              </div>
            )}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-none border border-border bg-primary/5 text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span
                className={cn(
                  "truncate text-sm font-semibold",
                  isSelected ? "text-primary" : "text-foreground"
                )}
              >
                {entry.label}
              </span>
              <span className="line-clamp-1 text-[12px] leading-normal text-muted-foreground">
                {entry.hint}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
