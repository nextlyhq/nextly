"use client";

/**
 * ArrayFieldEditor Component
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
 * @module components/features/schema-builder/ArrayFieldEditor
 */

import {
  Badge,
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

import type { ArrayFieldEditorProps, ArrayFieldLabels } from "./types";

// ============================================================
// ArrayFieldEditor Component
// ============================================================

export function ArrayFieldEditor({
  labels,
  onLabelsChange,
  initCollapsed,
  onInitCollapsedChange,
  isSortable,
  onIsSortableChange,
  rowLabelField,
  onRowLabelFieldChange,
  nestedFields = [],
}: ArrayFieldEditorProps) {
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
      const newLabels: ArrayFieldLabels = {
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
      const newLabels: ArrayFieldLabels = {
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
        <Label className="text-xs font-medium">Array Configuration</Label>
      </div>

      {/* Row Labels Section */}
      <div className="space-y-3">
        <FormLabelWithTooltip
          className="text-xs font-medium text-muted-foreground"
          label="Row Labels"
          description={`Used in buttons like "Add ${labels?.singular || "Item"}" and headers`}
        />

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
              placeholder="e.g., Item"
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
              placeholder="e.g., Items"
              className="h-8 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Row Label Field Selector */}
      <div className="space-y-2 pt-2 border-t border-border">
        <FormLabelWithTooltip
          className="text-xs font-medium"
          label="Row Label Field"
          description='Use a field value as the row label instead of "Item 1, Item 2..."'
        />
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
                <span>Default (Item 1, Item 2...)</span>
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

        {labelableFields.length === 0 && nestedFields.length > 0 && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-muted/50">
            <Icons.Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              Add a text, email, number, select, date, or slug field to use as
              row label
            </p>
          </div>
        )}
      </div>

      {/* Admin Options Section */}
      <div className="space-y-3 pt-2 border-t border-border">
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

      {/* Nested Fields Info */}
      <div className="pt-2 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs font-medium text-muted-foreground">
            Nested Fields
          </Label>
          <Badge variant="outline" className="text-xs">
            {nestedFields.length}{" "}
            {nestedFields.length === 1 ? "field" : "fields"}
          </Badge>
        </div>

        {nestedFields.length === 0 ? (
          <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
            <Icons.AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-amber-600 dark:text-amber-400">
              <p className="font-medium">No nested fields</p>
              <p className="mt-0.5">
                Add fields to this array by expanding it in the field list and
                dragging fields from the palette.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50">
            <Icons.Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div className="text-xs text-muted-foreground">
              <p>Click on nested fields in the field list to configure them.</p>
              <p className="mt-1">
                Fields:{" "}
                {nestedFields
                  .slice(0, 3)
                  .map(f => f.label || f.name)
                  .join(", ")}
                {nestedFields.length > 3 && ` +${nestedFields.length - 3} more`}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Validation Hint */}
      <div className="flex items-start gap-2 p-3 rounded-md bg-muted/30">
        <Icons.Settings className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
        <p className="text-xs text-muted-foreground">
          <strong>Tip:</strong> Use the Validation tab to set minimum and
          maximum number of rows.
        </p>
      </div>
    </div>
  );
}
