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

import { Label, Switch } from "@revnixhq/ui";

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

      {/* Why: PR I -- the "Nested Fields" info section was dropped. The
          field list now shows the nested children and the +Add
          affordance lives there. Group editor configures only the
          parent (gutter visibility). */}
      <EditorAlert>
        Groups organize related fields under a common property without creating
        repeatable rows like arrays.
      </EditorAlert>
    </div>
  );
}
