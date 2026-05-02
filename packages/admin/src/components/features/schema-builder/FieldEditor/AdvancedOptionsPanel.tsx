/**
 * AdvancedOptionsPanel
 *
 * Advanced tab content for the FieldEditor.
 * Contains: Unique toggle, Index toggle, Localized toggle (disabled), info box.
 *
 * @module components/features/schema-builder/FieldEditor/AdvancedOptionsPanel
 */

import { Label, Switch } from "@revnixhq/ui";

import * as Icons from "@admin/components/icons";

import type { BuilderField, BuilderFieldAdvanced } from "../types";

export interface AdvancedOptionsPanelProps {
  localField: BuilderField;
  onAdvancedUpdate: (updates: Partial<BuilderFieldAdvanced>) => void;
}

export function AdvancedOptionsPanel({
  localField,
  onAdvancedUpdate,
}: AdvancedOptionsPanelProps) {
  return (
    <>
      {/* Unique */}
      <div className="flex items-center justify-between py-2">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">Unique</Label>
          <p className="text-xs text-muted-foreground">
            Value must be unique across all entries
          </p>
        </div>
        <Switch
          checked={localField.advanced?.unique || false}
          onCheckedChange={checked => onAdvancedUpdate({ unique: checked })}
        />
      </div>

      {/* Index */}
      <div className="flex items-center justify-between py-2">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">Database Index</Label>
          <p className="text-xs text-muted-foreground">
            Create an index for faster queries
          </p>
        </div>
        <Switch
          checked={localField.advanced?.index || false}
          onCheckedChange={checked => onAdvancedUpdate({ index: checked })}
        />
      </div>

      {/* Localized (Reserved for future) */}
      <div className="flex items-center justify-between py-2 opacity-50">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium">Localized</Label>
            <span className="text-[10px] px-1.5 py-0.5 rounded-none bg-primary/5 text-muted-foreground">
              Coming Soon
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Store different values per locale
          </p>
        </div>
        <Switch
          checked={localField.advanced?.localized || false}
          onCheckedChange={checked => onAdvancedUpdate({ localized: checked })}
          disabled
        />
      </div>

      {/* Info box */}
      <div className="flex items-start gap-2 p-3 rounded-none bg-primary/5 mt-4">
        <Icons.Info className="h-4 w-4 text-muted-foreground mt-0.5" />
        <div className="text-xs text-muted-foreground">
          <p className="font-medium mb-1">About Advanced Options</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>
              <strong>Unique</strong> creates a database constraint
            </li>
            <li>
              <strong>Index</strong> improves query performance
            </li>
            <li>
              <strong>Localized</strong> enables multi-language content
            </li>
          </ul>
        </div>
      </div>
    </>
  );
}
