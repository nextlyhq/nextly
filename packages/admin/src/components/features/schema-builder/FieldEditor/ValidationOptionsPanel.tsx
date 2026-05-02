/**
 * ValidationOptionsPanel
 *
 * Validation tab content for the FieldEditor.
 * Renders type-specific validation options:
 * - Text: minLength, maxLength, pattern
 * - Number: min, max
 * - Rows: minRows, maxRows (repeater / hasMany)
 * - Chips: minChips, maxChips
 * - Custom error message
 *
 * @module components/features/schema-builder/FieldEditor/ValidationOptionsPanel
 */

import { Input, Label } from "@revnixhq/ui";

import * as Icons from "@admin/components/icons";

import type { BuilderField, BuilderFieldValidation } from "../types";

// Field types that support text validation (minLength, maxLength, pattern)
const TEXT_VALIDATION_TYPES = ["text", "textarea", "email", "password", "code"];

// Field types that support number validation (min, max)
const NUMBER_VALIDATION_TYPES = ["number"];

// Field types that support rows validation (minRows, maxRows)
const ROWS_VALIDATION_TYPES = ["repeater"];

// Field types that support chips validation (minChips, maxChips)
const CHIPS_VALIDATION_TYPES = ["chips"];

export interface ValidationOptionsPanelProps {
  localField: BuilderField;
  onValidationUpdate: (updates: Partial<BuilderFieldValidation>) => void;
}

export function ValidationOptionsPanel({
  localField,
  onValidationUpdate,
}: ValidationOptionsPanelProps) {
  const supportsText = TEXT_VALIDATION_TYPES.includes(localField.type);
  const supportsNumber = NUMBER_VALIDATION_TYPES.includes(localField.type);
  const supportsRows = ROWS_VALIDATION_TYPES.includes(localField.type);
  const supportsChips = CHIPS_VALIDATION_TYPES.includes(localField.type);

  return (
    <>
      {/* Text validation options */}
      {supportsText && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="min-length" className="text-xs font-medium">
                Min Length
              </Label>
              <Input
                id="min-length"
                type="number"
                min={0}
                value={localField.validation?.minLength ?? ""}
                onChange={e =>
                  onValidationUpdate({
                    minLength: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  })
                }
                placeholder="0"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-length" className="text-xs font-medium">
                Max Length
              </Label>
              <Input
                id="max-length"
                type="number"
                min={0}
                value={localField.validation?.maxLength ?? ""}
                onChange={e =>
                  onValidationUpdate({
                    maxLength: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  })
                }
                placeholder="No limit"
                className="h-8 text-sm"
              />
            </div>
          </div>

          {/* Pattern (regex) */}
          <div className="space-y-2">
            <Label htmlFor="pattern" className="text-xs font-medium">
              Pattern (Regex)
            </Label>
            <Input
              id="pattern"
              value={localField.validation?.pattern || ""}
              onChange={e =>
                onValidationUpdate({
                  pattern: e.target.value || undefined,
                })
              }
              placeholder="e.g., ^[a-z0-9-]+$"
              className="h-8 text-sm font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Regular expression pattern for validation
            </p>
          </div>
        </>
      )}

      {/* Number validation options */}
      {supportsNumber && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="min-value" className="text-xs font-medium">
              Minimum Value
            </Label>
            <Input
              id="min-value"
              type="number"
              value={localField.validation?.min ?? ""}
              onChange={e =>
                onValidationUpdate({
                  min: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              placeholder="No minimum"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max-value" className="text-xs font-medium">
              Maximum Value
            </Label>
            <Input
              id="max-value"
              type="number"
              value={localField.validation?.max ?? ""}
              onChange={e =>
                onValidationUpdate({
                  max: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              placeholder="No maximum"
              className="h-8 text-sm"
            />
          </div>
        </div>
      )}

      {/* Rows validation (for array/blocks or hasMany fields) */}
      {(supportsRows || localField.hasMany) && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="min-rows" className="text-xs font-medium">
              Min Items
            </Label>
            <Input
              id="min-rows"
              type="number"
              min={0}
              value={localField.validation?.minRows ?? ""}
              onChange={e =>
                onValidationUpdate({
                  minRows: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              placeholder="0"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max-rows" className="text-xs font-medium">
              Max Items
            </Label>
            <Input
              id="max-rows"
              type="number"
              min={0}
              value={localField.validation?.maxRows ?? ""}
              onChange={e =>
                onValidationUpdate({
                  maxRows: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              placeholder="No limit"
              className="h-8 text-sm"
            />
          </div>
        </div>
      )}

      {/* Custom validation message */}
      <div className="space-y-2">
        <Label htmlFor="validation-message" className="text-xs font-medium">
          Custom Error Message
        </Label>
        <Input
          id="validation-message"
          value={localField.validation?.message || ""}
          onChange={e =>
            onValidationUpdate({
              message: e.target.value || undefined,
            })
          }
          placeholder="e.g., Please enter a valid value"
          className="h-8 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Message shown when validation fails
        </p>
      </div>

      {/* Chips validation (minChips, maxChips) */}
      {supportsChips && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="min-chips" className="text-xs font-medium">
              Min Chips
            </Label>
            <Input
              id="min-chips"
              type="number"
              min={0}
              value={localField.validation?.minChips ?? ""}
              onChange={e =>
                onValidationUpdate({
                  minChips: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              placeholder="0"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max-chips" className="text-xs font-medium">
              Max Chips
            </Label>
            <Input
              id="max-chips"
              type="number"
              min={1}
              value={localField.validation?.maxChips ?? ""}
              onChange={e =>
                onValidationUpdate({
                  maxChips: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              placeholder="Unlimited"
              className="h-8 text-sm"
            />
          </div>
        </div>
      )}

      {/* No validation options message for certain types */}
      {!supportsText &&
        !supportsNumber &&
        !supportsRows &&
        !supportsChips &&
        !localField.hasMany && (
          <div className="flex items-center gap-2 p-3 rounded-none bg-primary/5">
            <Icons.Info className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              This field type has no additional validation options
            </p>
          </div>
        )}
    </>
  );
}
