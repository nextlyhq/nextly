"use client";

/**
 * SelectOptionsEditor
 *
 * The Schema Builder's editor for select/radio field options. It composes the
 * shared kit `FieldOptionsEditor` for the option list itself and layers the
 * builder's own select/radio field-admin knobs (multi-select, clearable,
 * placeholder, radio layout) around it. Keeping the knobs here — not in the
 * kit — is what lets the Form Builder and plugins share the same option list
 * without inheriting the builder's storage shape.
 *
 * @module components/features/schema-builder/SelectOptionsEditor
 */

import { Input, Switch } from "@nextlyhq/ui";

import {
  FieldOptionsEditor,
  type FieldOption,
} from "@admin/components/field-ui";
import { FormLabelWithTooltip } from "@admin/components/ui/form-label-with-tooltip";

import type { SelectOptionsEditorProps } from "./types";

export function SelectOptionsEditor({
  options,
  onOptionsChange,
  hasMany,
  onHasManyChange,
  fieldType,
  isClearable,
  onIsClearableChange,
  placeholder,
  onPlaceholderChange,
  layout,
  onLayoutChange,
}: SelectOptionsEditorProps) {
  // `SelectOption` and the kit's `FieldOption` are the same id/label/value
  // shape, so the list passes through untouched. The `readonly` widening keeps
  // the kit's controlled contract explicit at the boundary.
  const handleOptionsChange = (next: FieldOption[]) => {
    onOptionsChange(next);
  };

  return (
    <div className="space-y-3">
      <FieldOptionsEditor
        options={options}
        onOptionsChange={handleOptionsChange}
      />

      {/* Multi-select applies to select fields only; radio is single-choice. */}
      {fieldType === "select" && onHasManyChange && (
        <div className="mt-3 flex items-center justify-between border-t border-border py-2 pt-3">
          <div className="space-y-0.5">
            <FormLabelWithTooltip
              className="text-sm font-medium"
              label="Allow Multiple"
              description="Users can select more than one option"
            />
          </div>
          <Switch
            checked={hasMany || false}
            onCheckedChange={onHasManyChange}
          />
        </div>
      )}

      {/* Clearable + placeholder are select-only presentation, stored on the
          field's admin options by the caller. */}
      {fieldType === "select" && onIsClearableChange && (
        <div className="mt-3 flex items-center justify-between border-t border-border py-2 pt-3">
          <div className="space-y-0.5">
            <FormLabelWithTooltip
              className="text-sm font-medium"
              label="Clearable"
              description="Show a clear (X) button next to the picker so users can unset the value"
            />
          </div>
          <Switch
            aria-label="Clearable"
            checked={isClearable !== false}
            onCheckedChange={onIsClearableChange}
          />
        </div>
      )}
      {fieldType === "select" && onPlaceholderChange && (
        <div className="mt-3 space-y-2">
          <FormLabelWithTooltip
            className="text-xs font-medium"
            label="Placeholder"
            description="Text shown in the picker before any option is selected"
          />
          <Input
            value={placeholder ?? ""}
            onChange={event => onPlaceholderChange(event.target.value)}
            placeholder="e.g., Choose a category..."
            className="h-8 text-sm"
          />
        </div>
      )}

      {/* Layout is radio-only presentation, stored on the field's admin options
          by the caller. */}
      {fieldType === "radio" && onLayoutChange && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <FormLabelWithTooltip
            className="text-xs font-medium"
            label="Layout"
            description="Whether radio options stack vertically or sit side-by-side"
          />
          <div className="inline-flex divide-x divide-border overflow-hidden rounded-none border border-border">
            <button
              type="button"
              onClick={() => onLayoutChange("horizontal")}
              className={`px-3 py-1 text-xs ${
                (layout ?? "horizontal") === "horizontal"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              Horizontal
            </button>
            <button
              type="button"
              onClick={() => onLayoutChange("vertical")}
              className={`px-3 py-1 text-xs ${
                layout === "vertical"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              Vertical
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
