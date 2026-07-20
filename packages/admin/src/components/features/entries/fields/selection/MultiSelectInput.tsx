"use client";

/**
 * Multi Select Input Component
 *
 * A controlled multi-value select for `hasMany` select fields. Stores an
 * array of the selected option values and integrates with React Hook Form
 * via useController. Single-value selects use SelectInput instead.
 *
 * @module components/entries/fields/selection/MultiSelectInput
 * @since 1.0.0
 */

import {
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import type { SelectFieldConfig } from "nextly/config";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { X } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

// ============================================================
// Types
// ============================================================

export interface MultiSelectInputProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  name: Path<TFieldValues>;
  field: SelectFieldConfig;
  control: Control<TFieldValues>;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
}

// ============================================================
// Component
// ============================================================

export function MultiSelectInput<
  TFieldValues extends FieldValues = FieldValues,
>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
  className,
}: MultiSelectInputProps<TFieldValues>) {
  const {
    field: { value, onChange },
    fieldState: { invalid },
  } = useController({
    name,
    control,
    // hasMany selects store an array. Seed [] (never a scalar) so the field's
    // z.array() schema is satisfied for an untouched field and every update
    // keeps the value an array.
    defaultValue: (Array.isArray(field.defaultValue)
      ? field.defaultValue
      : []) as TFieldValues[Path<TFieldValues>],
  });

  // Preserve a stored scalar (e.g. a field switched single -> multi in the
  // Schema Builder, or a row written before the field became hasMany) as a
  // one-item array instead of silently dropping it to [] and overwriting the
  // value on the next save.
  const selected: string[] = Array.isArray(value)
    ? value
    : value != null && value !== ""
      ? [String(value)]
      : [];
  const isInteractive = !disabled && !readOnly;
  const options = field.options ?? [];
  // Only offer options that aren't already selected so each value is unique.
  const available = options.filter(option => !selected.includes(option.value));
  const placeholder = field.admin?.placeholder || "Select...";

  const labelFor = (optionValue: string) =>
    options.find(option => option.value === optionValue)?.label ?? optionValue;

  function addValue(optionValue: string) {
    if (!optionValue || selected.includes(optionValue)) return;
    onChange([...selected, optionValue] as TFieldValues[Path<TFieldValues>]);
  }

  function removeValue(optionValue: string) {
    if (!isInteractive) return;
    onChange(selected.filter(v => v !== optionValue));
  }

  return (
    <div className={cn("space-y-2", className)}>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(optionValue => (
            <Badge
              key={optionValue}
              variant="default"
              className="flex items-center gap-1 pr-1"
            >
              <span>{labelFor(optionValue)}</span>
              {isInteractive && (
                <button
                  type="button"
                  onClick={() => removeValue(optionValue)}
                  className="ml-0.5 rounded-none p-0.5 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label={`Remove ${labelFor(optionValue)}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}

      {isInteractive && available.length > 0 && (
        <Select
          // The trigger is an "add" affordance: picking an option appends it and
          // the control resets to empty (value="") so more can be added.
          value=""
          onValueChange={addValue}
        >
          <SelectTrigger id={name} aria-invalid={invalid || undefined}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {available.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Read-only / disabled with no selection: show an explicit empty marker
          instead of rendering a blank area. */}
      {!isInteractive && selected.length === 0 && (
        <span className="text-sm text-muted-foreground">—</span>
      )}
    </div>
  );
}
