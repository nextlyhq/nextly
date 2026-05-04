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

import { Badge, Button, Label, Switch } from "@revnixhq/ui";

import * as Icons from "@admin/components/icons";
import { FormLabelWithTooltip } from "@admin/components/ui/form-label-with-tooltip";

import { EditorAlert } from "./EditorAlert";
import type { GroupFieldEditorProps } from "./types";

// ============================================================
// GroupFieldEditor Component
// ============================================================

export function GroupFieldEditor({
  hideGutter,
  onHideGutterChange,
  nestedFields = [],
  onAddField,
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
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {nestedFields.length}{" "}
              {nestedFields.length === 1 ? "field" : "fields"}
            </Badge>
            {onAddField && (
              // PR D: parent-aware "+ Add field" button. Asks the host
              // page to open the FieldPickerModal scoped to this group.
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onAddField}
              >
                + Add field
              </Button>
            )}
          </div>
        </div>

        {nestedFields.length === 0 ? (
          // PR H feedback 2.2: subtle EditorAlert replaces the amber
          // panel.
          <EditorAlert>
            Add fields to this group using the + Add field button above.
          </EditorAlert>
        ) : (
          <EditorAlert>
            <p>Click on nested fields in the field list to configure them.</p>
            <p className="mt-1">
              Fields:{" "}
              {nestedFields
                .slice(0, 3)
                .map(f => f.label || f.name)
                .join(", ")}
              {nestedFields.length > 3 && ` +${nestedFields.length - 3} more`}
            </p>
          </EditorAlert>
        )}
      </div>

      {/* PR H feedback 2.2: subtle EditorAlert replaces the bg-primary/5
          Tip box. */}
      <EditorAlert>
        Groups organize related fields under a common property without creating
        repeatable rows like arrays.
      </EditorAlert>
    </div>
  );
}
