/**
 * GroupFieldEditor Component
 *
 * Editor for configuring group field settings.
 * Features:
 * - Hide gutter toggle (hide vertical line and padding in admin UI)
 * - Nested fields info section
 *
 * Note: Group fields are containers that organize related fields under
 * a common property. Unlike arrays, they don't repeat.
 *
 * @module components/features/schema-builder/GroupFieldEditor
 */

import { Badge, Label, Switch } from "@revnixhq/ui";

import * as Icons from "@admin/components/icons";
import { FormLabelWithTooltip } from "@admin/components/ui/form-label-with-tooltip";

import type { GroupFieldEditorProps } from "./types";

// ============================================================
// GroupFieldEditor Component
// ============================================================

export function GroupFieldEditor({
  hideGutter,
  onHideGutterChange,
  nestedFields = [],
}: GroupFieldEditorProps) {
  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center gap-2">
        <Icons.FolderOpen className="h-4 w-4 text-muted-foreground" />
        <Label className="text-xs font-medium">Group Configuration</Label>
      </div>

      {/* Admin Options Section */}
      <div className="space-y-3">
        <Label className="text-xs font-medium text-muted-foreground">
          Admin Options
        </Label>

        {/* Hide Gutter Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <FormLabelWithTooltip
              className="text-sm font-medium"
              label="Hide Gutter"
              description="Hide the vertical line and padding. Useful when this group is nested inside another group, array, or block to reduce visual clutter."
            />
          </div>
          <Switch
            checked={hideGutter || false}
            onCheckedChange={onHideGutterChange}
          />
        </div>
      </div>

      {/* Nested Fields Info */}
      <div className="pt-2  border-t border-primary/5">
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
          <div className="flex items-start gap-2 p-3 rounded-none bg-amber-500/10  border border-primary/5 border-amber-500/20">
            <Icons.AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-amber-600 dark:text-amber-400">
              <p className="font-medium">No nested fields</p>
              <p className="mt-0.5">
                Add fields to this group by expanding it in the field list and
                dragging fields from the palette.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 p-3 rounded-none bg-primary/5">
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

      {/* Info about groups */}
      <div className="flex items-start gap-2 p-3 rounded-none bg-primary/5">
        <Icons.Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
        <p className="text-xs text-muted-foreground">
          <strong>Tip:</strong> Groups organize related fields under a common
          property without creating repeatable rows like arrays.
        </p>
      </div>
    </div>
  );
}
