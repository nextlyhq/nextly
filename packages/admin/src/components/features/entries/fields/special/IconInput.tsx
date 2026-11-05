"use client";

/**
 * Icon Input Component
 *
 * The entry form's control for an `icon` field: ui's `IconField`, a button
 * showing the chosen icon that opens a search-first picker, wired to React
 * Hook Form. The stored value is the icon's id (`"lucide:star"`), or `""`
 * once cleared.
 *
 * Loaded lazily by `FieldRenderer`, so the module that names the icon set's
 * dynamic import sits in a chunk of its own.
 *
 * @module components/entries/fields/special/IconInput
 */

import { IconField } from "@nextlyhq/ui";
import type { IconFieldConfig } from "nextly/config";
import type { JSX } from "react";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { fieldLabel } from "@admin/lib/field-label";

import { useFieldElementId } from "../field-id-scope";

import { loadLucideIcons } from "./lucide-icon-source";

export interface IconInputProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /** Field path for React Hook Form registration. */
  name: Path<TFieldValues>;
  /** Field configuration from the collection schema. */
  field: IconFieldConfig;
  /** React Hook Form control object. */
  control: Control<TFieldValues>;
  /** Whether the field is disabled. */
  disabled?: boolean;
  /** Whether the field is read-only: shown, but not changed. */
  readOnly?: boolean;
}

/**
 * IconInput lets an editor choose one icon for an `icon` field.
 *
 * The field renders two buttons, the picker and the clear, so `FieldWrapper`
 * names it as a group; the picker button's own name repeats the label and
 * says the chosen icon (`Icon: Truck`), so it reads correctly when reached on
 * its own.
 */
export function IconInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
}: IconInputProps<TFieldValues>): JSX.Element {
  const elementId = useFieldElementId(name);
  const {
    field: { value, onChange, onBlur, ref },
    fieldState: { invalid },
  } = useController({ name, control });

  return (
    <IconField
      // The picker button, so React Hook Form focuses it on a rejected submit
      // and on `setFocus`, as it focuses a text input.
      ref={ref}
      id={elementId}
      value={typeof value === "string" && value !== "" ? value : null}
      // Cleared to "", the empty value every text-like field holds, so a
      // required icon field reports "required" rather than a type mismatch.
      onChange={id => onChange(id ?? "")}
      onBlur={onBlur}
      loadIcons={loadLucideIcons}
      label={fieldLabel({ label: field.label, name: field.name })}
      disabled={disabled}
      readOnly={readOnly}
      invalid={invalid}
    />
  );
}
