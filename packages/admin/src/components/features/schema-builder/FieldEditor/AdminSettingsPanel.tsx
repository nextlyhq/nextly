/**
 * AdminSettingsPanel
 *
 * Display/Admin tab content for the FieldEditor.
 * Contains: Width selector, Read-only toggle, Hidden toggle,
 * Conditional Display builder.
 *
 * @module components/features/schema-builder/FieldEditor/AdminSettingsPanel
 */

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@revnixhq/ui";

import * as Icons from "@admin/components/icons";

import type {
  BuilderField,
  BuilderFieldAdmin,
  FieldCondition,
  FieldWidth,
} from "../types";
import { FIELD_WIDTH_OPTIONS } from "../types";

export interface AdminSettingsPanelProps {
  localField: BuilderField;
  siblingFields: BuilderField[];
  onAdminUpdate: (updates: Partial<BuilderFieldAdmin>) => void;
  onConditionUpdate: (updates: Partial<FieldCondition> | null) => void;
}

export function AdminSettingsPanel({
  localField,
  siblingFields,
  onAdminUpdate,
  onConditionUpdate,
}: AdminSettingsPanelProps) {
  return (
    <>
      {/* Width */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Width</Label>
        <Select
          value={localField.admin?.width || "100%"}
          onValueChange={(value: FieldWidth) => onAdminUpdate({ width: value })}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Select width" />
          </SelectTrigger>
          <SelectContent>
            {FIELD_WIDTH_OPTIONS.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Field width in the form layout
        </p>
      </div>

      {/* Read-only */}
      <div className="flex items-center justify-between py-2">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">Read Only</Label>
          <p className="text-xs text-muted-foreground">
            Prevent editing in the admin UI
          </p>
        </div>
        <Switch
          checked={localField.admin?.readOnly || false}
          onCheckedChange={checked => onAdminUpdate({ readOnly: checked })}
        />
      </div>

      {/* Hidden */}
      <div className="flex items-center justify-between py-2">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">Hidden</Label>
          <p className="text-xs text-muted-foreground">
            Hide from the admin UI entirely
          </p>
        </div>
        <Switch
          checked={localField.admin?.hidden || false}
          onCheckedChange={checked => onAdminUpdate({ hidden: checked })}
        />
      </div>

      {/* Condition Builder (Simplified) */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Conditional Display</Label>
          {localField.admin?.condition && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground"
              onClick={() => onConditionUpdate(null)}
            >
              Remove
            </Button>
          )}
        </div>

        {localField.admin?.condition ? (
          <div className="space-y-2 p-3 rounded-md border border-border bg-background">
            <p className="text-xs text-muted-foreground mb-2">
              Show this field when:
            </p>
            <div className="grid grid-cols-2 gap-2">
              {siblingFields.length > 0 ? (
                <Select
                  value={localField.admin.condition.field || ""}
                  onValueChange={val => onConditionUpdate({ field: val })}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select field..." />
                  </SelectTrigger>
                  <SelectContent>
                    {siblingFields
                      .filter(f => f.name && f.id !== localField.id)
                      .map(f => (
                        <SelectItem key={f.id} value={f.name}>
                          {f.label || f.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={localField.admin.condition.field || ""}
                  onChange={e => onConditionUpdate({ field: e.target.value })}
                  placeholder="Field name"
                  className="h-8 text-sm font-mono"
                />
              )}
              <Input
                value={localField.admin.condition.equals || ""}
                onChange={e => onConditionUpdate({ equals: e.target.value })}
                placeholder="equals value"
                className="h-8 text-sm"
              />
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs"
            onClick={() => onConditionUpdate({ field: "", equals: "" })}
          >
            <Icons.Plus className="h-3 w-3 mr-1" />
            Add Condition
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          Only show this field when another field has a specific value
        </p>
      </div>
    </>
  );
}
