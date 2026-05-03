"use client";

/**
 * Chips Input Component
 *
 * A controlled chips/tags input that stores an array of unique strings.
 * Integrates with React Hook Form via useController.
 *
 * Features:
 * - Add chips by pressing Enter or comma
 * - Remove chips by clicking × or pressing Backspace on empty input
 * - Prevents duplicate values
 * - Respects maxChips limit
 *
 * @module components/entries/fields/selection/ChipsInput
 * @since 1.0.0
 */

import type { ChipsFieldConfig } from "@revnixhq/nextly/config";
import { Badge } from "@revnixhq/ui";
import { X } from "lucide-react";
import { useState, useRef, type KeyboardEvent } from "react";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { cn } from "@admin/lib/utils";

// ============================================================
// Types
// ============================================================

export interface ChipsInputProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  name: Path<TFieldValues>;
  field: ChipsFieldConfig;
  control: Control<TFieldValues>;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
}

// ============================================================
// Component
// ============================================================

export function ChipsInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
  className,
}: ChipsInputProps<TFieldValues>) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    field: { value, onChange },
  } = useController({
    name,
    control,
    defaultValue: (field.defaultValue instanceof Array
      ? field.defaultValue
      : []) as TFieldValues[Path<TFieldValues>],
  });

  const chips: string[] = Array.isArray(value) ? value : [];
  const atLimit =
    field.maxChips !== undefined && chips.length >= field.maxChips;
  const isInteractive = !disabled && !readOnly;

  function addChip(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (chips.includes(trimmed)) {
      setInputValue("");
      return;
    }
    if (atLimit) return;
    onChange([...chips, trimmed] as TFieldValues[Path<TFieldValues>]);
    setInputValue("");
  }

  function removeChip(index: number) {
    if (!isInteractive) return;
    const next = chips.filter((_, i) => i !== index);
    onChange(next);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addChip(inputValue);
    } else if (e.key === "Backspace" && inputValue === "" && chips.length > 0) {
      removeChip(chips.length - 1);
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-10 flex-wrap gap-1.5 rounded-none  border border-primary/5 bg-background px-3 py-2 text-sm",
        "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0",
        (disabled || readOnly) && "cursor-not-allowed bg-primary/5 opacity-70",
        className
      )}
      onClick={() => {
        if (isInteractive) inputRef.current?.focus();
      }}
    >
      {chips.map((chip, index) => (
        <Badge
          key={`${chip}-${index}`}
          variant="default"
          className="flex items-center gap-1 pr-1"
        >
          <span>{chip}</span>
          {isInteractive && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                removeChip(index);
              }}
              className="ml-0.5 rounded-none p-0.5 hover:bg-black/10 focus:outline-none"
              tabIndex={-1}
              aria-label={`Remove ${chip}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </Badge>
      ))}

      {isInteractive && !atLimit && (
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => addChip(inputValue)}
          placeholder={
            chips.length === 0
              ? (field.admin?.placeholder ?? "Type and press Enter to add")
              : ""
          }
          className="min-w-[120px] flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          disabled={disabled}
        />
      )}

      {atLimit && chips.length > 0 && (
        <span className="self-center text-xs text-muted-foreground">
          Max {field.maxChips} chips reached
        </span>
      )}
    </div>
  );
}
