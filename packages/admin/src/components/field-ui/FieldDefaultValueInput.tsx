"use client";

import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { useMemo } from "react";

/**
 * Radix Select rejects an empty-string item value, so "no default" is a
 * sentinel translated back to "" at the onChange boundary. The base spelling
 * is extended until it collides with no real option value, so an option
 * literally valued "__none__" still selects itself instead of clearing the
 * default.
 */
const NO_DEFAULT_BASE = "__none__";

function uncollidedSentinel(values: ReadonlySet<string>): string {
  let sentinel = NO_DEFAULT_BASE;
  while (values.has(sentinel)) sentinel += "_";
  return sentinel;
}

export interface FieldDefaultOption {
  label: string;
  value: string;
}

export interface FieldDefaultValueInputProps {
  /**
   * The field type whose default is being edited. Drives the control:
   * checkbox → true/false select; select/radio with options → a select of
   * those options; number/date → a typed input; anything else → text.
   */
  fieldType: string;
  /** Options for select/radio types; ignored otherwise. */
  options?: readonly FieldDefaultOption[];
  /** The default value as a string; "" means no default. */
  value: string;
  /** Called with the new default; "" when cleared. */
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Accessible name for the control. */
  ariaLabel?: string;
}

/**
 * Type-aware default-value control, controlled and form-library agnostic.
 * Every surface that lets a field declare a default renders this, so a
 * checkbox default is always the same true/false choice and a select default
 * is always a choice among the field's own options.
 */
export function FieldDefaultValueInput({
  fieldType,
  options = [],
  value,
  onChange,
  disabled,
  ariaLabel = "Default value",
}: FieldDefaultValueInputProps) {
  const validOptions = useMemo(
    () => options.filter(option => option.value.trim()),
    [options]
  );
  const noDefault = useMemo(
    () =>
      uncollidedSentinel(
        new Set(["true", "false", ...validOptions.map(option => option.value)])
      ),
    [validOptions]
  );

  if (fieldType === "checkbox") {
    return (
      <Select
        value={value || noDefault}
        onValueChange={val => onChange(val === noDefault ? "" : val)}
        disabled={disabled}
      >
        <SelectTrigger aria-label={ariaLabel}>
          <SelectValue placeholder="No default" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={noDefault}>No default</SelectItem>
          <SelectItem value="true">Checked (true)</SelectItem>
          <SelectItem value="false">Unchecked (false)</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (
    (fieldType === "select" || fieldType === "radio") &&
    validOptions.length > 0
  ) {
    return (
      <Select
        value={value || noDefault}
        onValueChange={val => onChange(val === noDefault ? "" : val)}
        disabled={disabled}
      >
        <SelectTrigger aria-label={ariaLabel}>
          <SelectValue placeholder="No default" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={noDefault}>No default</SelectItem>
          {validOptions.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label || option.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      type={
        fieldType === "number"
          ? "number"
          : fieldType === "date"
            ? "date"
            : "text"
      }
      placeholder={fieldType === "date" ? "" : "Enter default value"}
      aria-label={ariaLabel}
      disabled={disabled}
      value={value}
      onChange={event => onChange(event.target.value)}
    />
  );
}
