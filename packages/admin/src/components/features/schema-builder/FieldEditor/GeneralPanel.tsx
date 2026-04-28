/**
 * GeneralPanel
 *
 * General tab content for the FieldEditor.
 * Renders core field configuration: Label, Name, Type display, Description,
 * Placeholder, Required, Default Value, and type-specific editors (Options,
 * Relationship, Upload, Array, Group, Component).
 *
 * @module components/features/schema-builder/FieldEditor/GeneralPanel
 */

import { Checkbox, Input, Label, Switch, Textarea } from "@revnixhq/ui";

import * as Icons from "@admin/components/icons";

import { ArrayFieldEditor } from "../ArrayFieldEditor";
import { ComponentFieldEditor } from "../ComponentFieldEditor";
import { GroupFieldEditor } from "../GroupFieldEditor";
import { RelationshipEditor } from "../RelationshipEditor";
import { SelectOptionsEditor } from "../SelectOptionsEditor";
import type {
  ArrayFieldLabels,
  BuilderField,
  BuilderFieldAdmin,
  BuilderFieldValidation,
  FieldOption,
  RelationshipFilter,
} from "../types";
import { UploadEditor } from "../UploadEditor";

import {
  FIELD_TYPE_ICONS,
  formatFieldType,
  hasOptions,
  iconMap,
  isArrayField,
  isComponentField,
  isGroupField,
  isRelationshipField,
  isUploadField,
} from "./utils";

interface GeneralPanelProps {
  localField: BuilderField;
  isSystemField: boolean;
  isLayout: boolean;
  onUpdate: (updates: Partial<BuilderField>) => void;
  onLabelChange: (label: string) => void;
  onValidationUpdate: (updates: Partial<BuilderFieldValidation>) => void;
  onAdminUpdate: (updates: Partial<BuilderFieldAdmin>) => void;
}

export function GeneralPanel({
  localField,
  isSystemField,
  isLayout,
  onUpdate,
  onLabelChange,
  onValidationUpdate,
  onAdminUpdate,
}: GeneralPanelProps) {
  const iconName = FIELD_TYPE_ICONS[localField.type] || "FileText";
  const IconComponent = (iconMap[iconName] || Icons.FileText);

  return (
    <>
      {/* System field notice */}
      {isSystemField && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50 border border-border">
          <Icons.Lock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            This is a system field. Its name and type cannot be changed.
          </p>
        </div>
      )}

      {/* Label */}
      <div className="space-y-2">
        <Label htmlFor="field-label" className="text-xs font-medium">
          Label
        </Label>
        <Input
          id="field-label"
          value={localField.label || ""}
          onChange={e => onLabelChange(e.target.value)}
          placeholder="e.g., Title"
          className="h-8 text-sm"
          disabled={isSystemField}
        />
        <p className="text-xs text-muted-foreground">
          The display name shown in the admin UI
        </p>
      </div>

      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="field-name" className="text-xs font-medium">
          Name
        </Label>
        <Input
          id="field-name"
          value={localField.name || ""}
          onChange={e => onUpdate({ name: e.target.value })}
          placeholder="e.g., title"
          className="h-8 text-sm font-mono"
          disabled={isSystemField}
        />
        <p className="text-xs text-muted-foreground">
          The field name used in the database and API
        </p>
      </div>

      {/* Type (read-only) */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Type</Label>
        <div className="flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-muted/50">
          <IconComponent className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {formatFieldType(localField.type)}
          </span>
        </div>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="field-description" className="text-xs font-medium">
          Description
        </Label>
        <Textarea
          id="field-description"
          value={localField.description || ""}
          onChange={e => onUpdate({ description: e.target.value })}
          placeholder="Help text for editors"
          className="text-sm resize-none"
          rows={2}
        />
      </div>

      {/* Placeholder */}
      {!isLayout && (
        <div className="space-y-2">
          <Label htmlFor="field-placeholder" className="text-xs font-medium">
            Placeholder
          </Label>
          <Input
            id="field-placeholder"
            value={localField.admin?.placeholder || ""}
            onChange={e => onAdminUpdate({ placeholder: e.target.value })}
            placeholder="e.g., Enter your name"
            className="h-8 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Placeholder text shown when the field is empty
          </p>
        </div>
      )}

      {/* Required (not for layout fields) */}
      {!isLayout && (
        <div className="flex items-center justify-between py-2">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Required</Label>
            <p className="text-xs text-muted-foreground">
              This field must have a value
            </p>
          </div>
          <Switch
            checked={localField.validation?.required || false}
            onCheckedChange={checked =>
              onValidationUpdate({ required: checked })
            }
            disabled={isSystemField}
          />
        </div>
      )}

      {/* Default Value (not for layout or complex fields) */}
      {!isLayout &&
        !["repeater", "group", "relationship", "upload"].includes(
          localField.type
        ) && (
          <div className="space-y-2">
            <Label htmlFor="field-default" className="text-xs font-medium">
              Default Value
            </Label>
            {localField.type === "checkbox" ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="field-default"
                  checked={localField.defaultValue === true}
                  onCheckedChange={checked =>
                    onUpdate({ defaultValue: checked === true })
                  }
                />
                <Label
                  htmlFor="field-default"
                  className="text-sm text-muted-foreground"
                >
                  Checked by default
                </Label>
              </div>
            ) : localField.type === "number" ? (
              <Input
                id="field-default"
                type="number"
                value={
                  localField.defaultValue !== null &&
                  localField.defaultValue !== undefined
                    ? String(localField.defaultValue)
                    : ""
                }
                onChange={e =>
                  onUpdate({
                    defaultValue: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
                placeholder="e.g., 0"
                className="h-8 text-sm"
              />
            ) : localField.type === "date" ? (
              <Input
                id="field-default"
                type="date"
                value={
                  localField.defaultValue
                    ? (() => {
                        try {
                          const d = new Date(localField.defaultValue as string);
                          if (!Number.isNaN(d.getTime())) {
                            return d.toISOString().split("T")[0];
                          }
                        } catch {
                          // ignore
                        }
                        return "";
                      })()
                    : ""
                }
                onChange={e => {
                  if (!e.target.value) {
                    onUpdate({ defaultValue: null });
                  } else {
                    // Store as UTC midnight ISO string to avoid timezone issues
                    onUpdate({
                      defaultValue: `${e.target.value}T00:00:00.000Z`,
                    });
                  }
                }}
                className="h-8 text-sm"
              />
            ) : (
              <Input
                id="field-default"
                value={
                  localField.defaultValue !== null &&
                  localField.defaultValue !== undefined
                    ? String(localField.defaultValue)
                    : ""
                }
                onChange={e =>
                  onUpdate({
                    defaultValue: e.target.value || null,
                  })
                }
                placeholder="Default value"
                className="h-8 text-sm"
              />
            )}
            <p className="text-xs text-muted-foreground">
              Value used when creating new entries
            </p>
          </div>
        )}

      {/* Options Editor (for select and radio fields) */}
      {hasOptions(localField.type) && (
        <div className="pt-2 border-t border-border">
          <SelectOptionsEditor
            options={
              // Convert FieldOption[] to SelectOption[] by preserving existing ids or adding new ones
              (localField.options || []).map((opt, index) => ({
                id: opt.id || `opt_${index}_${opt.value || index}`,
                label: opt.label,
                value: opt.value,
              }))
            }
            onOptionsChange={options => {
              // Convert SelectOption[] back to FieldOption[] (preserve ids)
              const fieldOptions: FieldOption[] = options.map(opt => ({
                id: opt.id,
                label: opt.label,
                value: opt.value,
              }));
              onUpdate({ options: fieldOptions });
            }}
            hasMany={localField.hasMany}
            onHasManyChange={
              localField.type === "select"
                ? checked => onUpdate({ hasMany: checked })
                : undefined
            }
            fieldType={localField.type as "select" | "radio"}
          />
        </div>
      )}

      {/* Relationship Editor (for relationship fields) */}
      {isRelationshipField(localField.type) && (
        <div className="pt-2 border-t border-border">
          <RelationshipEditor
            relationTo={localField.relationTo}
            onRelationToChange={relationTo => onUpdate({ relationTo })}
            hasMany={localField.hasMany}
            onHasManyChange={hasMany => onUpdate({ hasMany })}
            maxDepth={localField.maxDepth}
            onMaxDepthChange={maxDepth => onUpdate({ maxDepth })}
            allowCreate={localField.allowCreate}
            onAllowCreateChange={allowCreate => onUpdate({ allowCreate })}
            allowEdit={localField.allowEdit}
            onAllowEditChange={allowEdit => onUpdate({ allowEdit })}
            isSortable={localField.isSortable}
            onIsSortableChange={isSortable => onUpdate({ isSortable })}
            filterOptions={localField.relationshipFilter}
            onFilterOptionsChange={(filter: RelationshipFilter | undefined) =>
              onUpdate({ relationshipFilter: filter })
            }
          />
        </div>
      )}

      {/* Upload Editor (for upload fields) */}
      {isUploadField(localField.type) && (
        <div className="pt-2 border-t border-border">
          <UploadEditor
            relationTo={localField.relationTo}
            onRelationToChange={relationTo => onUpdate({ relationTo })}
            hasMany={localField.hasMany}
            onHasManyChange={hasMany => onUpdate({ hasMany })}
            mimeTypes={localField.mimeTypes}
            onMimeTypesChange={mimeTypes => onUpdate({ mimeTypes })}
            maxFileSize={localField.maxFileSize}
            onMaxFileSizeChange={maxFileSize => onUpdate({ maxFileSize })}
            allowCreate={localField.allowCreate}
            onAllowCreateChange={allowCreate => onUpdate({ allowCreate })}
            allowEdit={localField.allowEdit}
            onAllowEditChange={allowEdit => onUpdate({ allowEdit })}
            isSortable={localField.isSortable}
            onIsSortableChange={isSortable => onUpdate({ isSortable })}
            displayPreview={localField.displayPreview}
            onDisplayPreviewChange={displayPreview =>
              onUpdate({ displayPreview })
            }
          />
        </div>
      )}

      {/* Array Editor (for array fields) */}
      {isArrayField(localField.type) && (
        <div className="pt-2 border-t border-border">
          <ArrayFieldEditor
            labels={localField.labels}
            onLabelsChange={(labels: ArrayFieldLabels | undefined) =>
              onUpdate({ labels })
            }
            initCollapsed={localField.initCollapsed}
            onInitCollapsedChange={initCollapsed => onUpdate({ initCollapsed })}
            isSortable={localField.isSortable}
            onIsSortableChange={isSortable => onUpdate({ isSortable })}
            rowLabelField={localField.rowLabelField}
            onRowLabelFieldChange={rowLabelField => onUpdate({ rowLabelField })}
            nestedFields={localField.fields}
          />
        </div>
      )}

      {/* Group Editor (for group fields) */}
      {isGroupField(localField.type) && (
        <div className="pt-2 border-t border-border">
          <GroupFieldEditor
            hideGutter={localField.admin?.hideGutter}
            onHideGutterChange={hideGutter => onAdminUpdate({ hideGutter })}
            nestedFields={localField.fields}
          />
        </div>
      )}

      {/* Component Editor (for component fields) */}
      {isComponentField(localField.type) && (
        <div className="pt-2 border-t border-border">
          <ComponentFieldEditor
            component={localField.component}
            onComponentChange={component => onUpdate({ component })}
            components={localField.components}
            onComponentsChange={components => onUpdate({ components })}
            repeatable={localField.repeatable}
            onRepeatableChange={repeatable => onUpdate({ repeatable })}
            minRows={localField.validation?.minRows}
            onMinRowsChange={minRows => onValidationUpdate({ minRows })}
            maxRows={localField.validation?.maxRows}
            onMaxRowsChange={maxRows => onValidationUpdate({ maxRows })}
            initCollapsed={localField.initCollapsed}
            onInitCollapsedChange={initCollapsed => onUpdate({ initCollapsed })}
            isSortable={localField.isSortable}
            onIsSortableChange={isSortable => onUpdate({ isSortable })}
          />
        </div>
      )}
    </>
  );
}
