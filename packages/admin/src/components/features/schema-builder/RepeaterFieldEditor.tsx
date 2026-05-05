"use client";

/**
 * RepeaterFieldEditor Component
 *
 * Editor for configuring array field settings.
 * Features:
 * - Row labels (singular/plural) for UI display
 * - Row label field selector (use a nested field value as row label)
 * - initCollapsed toggle (start rows collapsed)
 * - isSortable toggle (allow drag-to-reorder)
 *
 * Note: minRows/maxRows are configured in the Validation tab.
 * Nested fields are managed by clicking on them in the main FieldList.
 *
 * @module components/features/schema-builder/RepeaterFieldEditor
 */

import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@revnixhq/ui";
import { useCallback, useMemo } from "react";

import * as Icons from "@admin/components/icons";
import { FormLabelWithTooltip } from "@admin/components/ui/form-label-with-tooltip";

import { EditorAlert } from "./EditorAlert";
import type { RepeaterFieldEditorProps, RepeaterFieldLabels } from "./types";

// ============================================================
// RepeaterFieldEditor Component
// ============================================================

export function RepeaterFieldEditor({
  labels,
  onLabelsChange,
  initCollapsed,
  onInitCollapsedChange,
  isSortable,
  onIsSortableChange,
  rowLabelField,
  onRowLabelFieldChange,
  nestedFields = [],
}: RepeaterFieldEditorProps) {
  // Get fields that can be used as row labels (text-like fields with names)
  const labelableFields = useMemo(() => {
    return nestedFields.filter(
      field =>
        field.name &&
        ["text", "email", "number", "select", "date", "slug"].includes(
          field.type
        )
    );
  }, [nestedFields]);

  // Handle singular label change
  const handleSingularChange = useCallback(
    (singular: string) => {
      const newLabels: RepeaterFieldLabels = {
        ...labels,
        singular: singular || undefined,
      };
      // Only set labels if at least one value is set
      if (newLabels.singular || newLabels.plural) {
        onLabelsChange(newLabels);
      } else {
        onLabelsChange(undefined);
      }
    },
    [labels, onLabelsChange]
  );

  // Handle plural label change
  const handlePluralChange = useCallback(
    (plural: string) => {
      const newLabels: RepeaterFieldLabels = {
        ...labels,
        plural: plural || undefined,
      };
      // Only set labels if at least one value is set
      if (newLabels.singular || newLabels.plural) {
        onLabelsChange(newLabels);
      } else {
        onLabelsChange(undefined);
      }
    },
    [labels, onLabelsChange]
  );

  // Handle row label field change
  const handleRowLabelFieldChange = useCallback(
    (value: string) => {
      if (value === "__default__") {
        onRowLabelFieldChange(undefined);
      } else {
        onRowLabelFieldChange(value);
      }
    },
    [onRowLabelFieldChange]
  );

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center gap-2">
        <Icons.Layers className="h-4 w-4 text-muted-foreground" />
        <Label className="text-xs font-medium">Repeater Configuration</Label>
      </div>

      {/* Row Labels Section */}
      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs font-medium">Row labels</Label>
          <p className="text-xs text-muted-foreground leading-relaxed">
            What this list calls individual rows. Used in the &ldquo;Add&rdquo;
            button, empty state, and validation messages.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Singular Label */}
          <div className="space-y-1.5">
            <Label htmlFor="singular-label" className="text-xs font-medium">
              Singular
            </Label>
            <Input
              id="singular-label"
              value={labels?.singular || ""}
              onChange={e => handleSingularChange(e.target.value)}
              placeholder="Item"
              className="h-8 text-sm"
            />
          </div>

          {/* Plural Label */}
          <div className="space-y-1.5">
            <Label htmlFor="plural-label" className="text-xs font-medium">
              Plural
            </Label>
            <Input
              id="plural-label"
              value={labels?.plural || ""}
              onChange={e => handlePluralChange(e.target.value)}
              placeholder="Items"
              className="h-8 text-sm"
            />
          </div>
        </div>

        {/* Live preview — substitutes the user's current values into the
            same surfaces the entry-form renderer will use. */}
        <div className="rounded border border-dashed border-primary/10 bg-primary/[0.02] p-2.5 space-y-1">
          <p className="text-[10px] font-bold tracking-[0.08em] uppercase text-muted-foreground">
            Preview
          </p>
          <p className="text-xs text-foreground/80">
            + Add {labels?.singular || "Item"}
          </p>
          <p className="text-xs text-muted-foreground">
            No {labels?.plural || "Items"} yet
          </p>
          <p className="text-xs text-destructive/80">
            Minimum 1 {labels?.singular || "Item"} required
          </p>
        </div>
      </div>

      {/* Collapsed row title */}
      <div className="space-y-2 pt-2 border-t border-primary/5">
        <div className="space-y-1">
          <Label className="text-xs font-medium">Collapsed row title</Label>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Pick a sub-field whose value will label each row when collapsed.
            Falls back to auto-detect (title, name, label, heading, subject)
            when left as auto.
          </p>
        </div>
        <Select
          value={rowLabelField || "__default__"}
          onValueChange={handleRowLabelFieldChange}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Select a field" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__default__">
              <div className="flex items-center gap-2">
                <Icons.Hash className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Auto-detect (recommended)</span>
              </div>
            </SelectItem>
            {labelableFields.map(field => (
              <SelectItem key={field.id} value={field.name || field.id}>
                <div className="flex items-center gap-2">
                  <Icons.Type className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{field.label || field.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ({field.name})
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Live preview — three sample collapsed rows showing what the row
            label will look like with the current selection. */}
        <div className="rounded border border-dashed border-primary/10 bg-primary/[0.02] p-2.5 space-y-1">
          <p className="text-[10px] font-bold tracking-[0.08em] uppercase text-muted-foreground">
            Preview when rows are collapsed
          </p>
          {(rowLabelField
            ? ["Sample value 1", "Sample value 2", "Sample value 3"]
            : [
                `${labels?.singular || "Item"} 1`,
                `${labels?.singular || "Item"} 2`,
                `${labels?.singular || "Item"} 3`,
              ]
          ).map((rowText, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-xs text-foreground/80"
            >
              <span className="text-muted-foreground">▸</span>
              <span className="text-muted-foreground">{i + 1}</span>
              <span>{rowText}</span>
            </div>
          ))}
        </div>

        {labelableFields.length === 0 && nestedFields.length > 0 && (
          <div className="flex items-start gap-2 p-2 rounded-none bg-primary/5">
            <Icons.Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              Add a text, email, number, select, date, or slug field to use as
              row label
            </p>
          </div>
        )}
      </div>

      {/* Admin Options Section */}
      <div className="space-y-3 pt-2  border-t border-primary/5">
        <Label className="text-xs font-medium text-muted-foreground">
          Admin Options
        </Label>

        {/* Init Collapsed Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <FormLabelWithTooltip
              className="text-sm font-medium"
              label="Collapsed by Default"
              description="Start with rows collapsed"
            />
          </div>
          <Switch
            checked={initCollapsed || false}
            onCheckedChange={onInitCollapsedChange}
          />
        </div>

        {/* Is Sortable Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <FormLabelWithTooltip
              className="text-sm font-medium"
              label="Allow Reordering"
              description="Drag to reorder rows"
            />
          </div>
          <Switch
            checked={isSortable !== false}
            onCheckedChange={onIsSortableChange}
          />
        </div>
      </div>

      {/* Why: PR I -- the "Nested Fields" info section (badge count +
          +Add field button + alert about clicking the field list) was
          dropped. The field list itself now shows the nested children
          and the +Add affordance lives there. The sheet keeps just the
          knobs that configure the repeater itself. */}
      <EditorAlert>
        Use the Validation tab to set minimum and maximum number of rows.
      </EditorAlert>
    </div>
  );
}
