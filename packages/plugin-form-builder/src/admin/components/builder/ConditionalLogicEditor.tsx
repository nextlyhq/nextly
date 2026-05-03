"use client";

/**
 * Conditional Logic Editor
 *
 * Component for configuring conditional show/hide logic for form fields.
 * Allows users to define conditions based on other field values.
 *
 * @module admin/components/builder/ConditionalLogicEditor
 * @since 0.1.0
 */

"use client";

import { FormLabelWithTooltip } from "@revnixhq/admin";
import {
  Input,
  Button,
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@revnixhq/ui";
import { useCallback, useMemo } from "react";

import type {
  FormField,
  ConditionalLogic,
  ConditionalLogicCondition,
} from "../../../types";

// ============================================================================
// Types
// ============================================================================

export interface ConditionalLogicEditorProps {
  /** The field being edited */
  field: FormField;
  /** All fields in the form (for field references) */
  allFields: FormField[];
  /** Callback when conditional logic is updated */
  onUpdate: (updates: Partial<FormField>) => void;
}

// ============================================================================
// Constants
// ============================================================================

const COMPARISON_OPERATORS: Array<{
  value: ConditionalLogicCondition["comparison"];
  label: string;
}> = [
  { value: "equals", label: "Equals" },
  { value: "notEquals", label: "Does not equal" },
  { value: "contains", label: "Contains" },
  { value: "isEmpty", label: "Is empty" },
  { value: "isNotEmpty", label: "Is not empty" },
  { value: "greaterThan", label: "Greater than" },
  { value: "lessThan", label: "Less than" },
];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Coerce a condition's `value` (stored as `unknown`) into a string
 * suitable for the controlled `<Input>`. Objects are JSON-stringified
 * so we never render `[object Object]`.
 */
function conditionValueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- value narrowed to primitive above; rule doesn't follow control flow on unknown
  return String(value);
}

// ============================================================================
// Component
// ============================================================================

/**
 * ConditionalLogicEditor - Configure conditional show/hide logic
 *
 * Allows users to define when a field should be shown or hidden
 * based on the values of other fields in the form.
 *
 * @example
 * ```tsx
 * <ConditionalLogicEditor
 *   field={selectedField}
 *   allFields={allFields}
 *   onUpdate={handleUpdate}
 * />
 * ```
 */
export function ConditionalLogicEditor({
  field,
  allFields,
  onUpdate,
}: ConditionalLogicEditorProps) {
  // Get current conditional logic or create default.
  // Wrapped in useMemo so dependent useCallbacks don't re-create on every render.
  const logic: ConditionalLogic = useMemo(
    () =>
      field.conditionalLogic || {
        enabled: false,
        action: "show",
        operator: "AND",
        conditions: [],
      },
    [field.conditionalLogic]
  );

  // Get other fields that can be referenced (exclude current field)
  const availableFields = allFields.filter(f => f.name !== field.name);

  // Update the entire conditional logic object
  const updateLogic = useCallback(
    (updates: Partial<ConditionalLogic>) => {
      onUpdate({
        conditionalLogic: { ...logic, ...updates },
      });
    },
    [logic, onUpdate]
  );

  // Toggle enabled state
  const handleToggleEnabled = useCallback(() => {
    updateLogic({ enabled: !logic.enabled });
  }, [logic.enabled, updateLogic]);

  // Add a new condition
  const handleAddCondition = useCallback(() => {
    const firstField = availableFields[0];
    if (!firstField) return;

    const newCondition: ConditionalLogicCondition = {
      field: firstField.name,
      comparison: "equals",
      value: "",
    };

    updateLogic({
      conditions: [...logic.conditions, newCondition],
    });
  }, [availableFields, logic.conditions, updateLogic]);

  // Update a specific condition
  const handleUpdateCondition = useCallback(
    (index: number, updates: Partial<ConditionalLogicCondition>) => {
      const newConditions = logic.conditions.map((c, i) =>
        i === index ? { ...c, ...updates } : c
      );
      updateLogic({ conditions: newConditions });
    },
    [logic.conditions, updateLogic]
  );

  // Remove a condition
  const handleRemoveCondition = useCallback(
    (index: number) => {
      const newConditions = logic.conditions.filter((_, i) => i !== index);
      updateLogic({ conditions: newConditions });
    },
    [logic.conditions, updateLogic]
  );

  // Check if comparison needs a value input
  const needsValue = (comparison: ConditionalLogicCondition["comparison"]) => {
    return comparison !== "isEmpty" && comparison !== "isNotEmpty";
  };

  return (
    <div className="space-y-6 pt-2">
      {/* Enable toggle */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Checkbox
            id="logic-enabled"
            checked={logic.enabled}
            onCheckedChange={handleToggleEnabled}
          />
          <FormLabelWithTooltip
            label="Enable conditional logic"
            htmlFor="logic-enabled"
            description="Show or hide this field based on other field values."
          />
        </div>
      </div>

      {logic.enabled && (
        <div className="space-y-4 pt-4 border-t border-primary/5">
          {/* Action and operator row */}
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Select
              value={logic.action}
              onValueChange={value =>
                updateLogic({ action: value as "show" | "hide" })
              }
            >
              <SelectTrigger className="w-[100px] h-9 bg-transparent border-input dark:bg-slate-900/50">
                <SelectValue placeholder="Show/Hide" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="show">Show</SelectItem>
                <SelectItem value="hide">Hide</SelectItem>
              </SelectContent>
            </Select>
            <span>this field when</span>
            <Select
              value={logic.operator}
              onValueChange={value =>
                updateLogic({ operator: value as "AND" | "OR" })
              }
            >
              <SelectTrigger className="w-[80px] h-9 bg-transparent border-input dark:bg-slate-900/50">
                <SelectValue placeholder="All/Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AND">All</SelectItem>
                <SelectItem value="OR">Any</SelectItem>
              </SelectContent>
            </Select>
            <span>of the following conditions are met:</span>
          </div>

          {/* Conditions list */}
          <div className="space-y-3 pt-4">
            {logic.conditions.length === 0 ? (
              <div className="p-4 bg-primary/5/30 rounded-none border border-dashed border-primary/5 text-center text-xs text-muted-foreground">
                No conditions defined. Add a condition to get started.
              </div>
            ) : (
              logic.conditions.map((condition, index) => (
                <div
                  key={index}
                  className="flex flex-col gap-2 p-3 rounded-none bg-primary/5/20 border border-primary/5 relative group"
                >
                  <div className="grid grid-cols-1 gap-2">
                    {/* Field selector */}
                    <Select
                      value={condition.field}
                      onValueChange={value =>
                        handleUpdateCondition(index, { field: value })
                      }
                    >
                      <SelectTrigger className="w-full bg-transparent border-input dark:bg-slate-900/50">
                        <SelectValue placeholder="Select field" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableFields.map(f => (
                          <SelectItem key={f.name} value={f.name}>
                            {f.label || f.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <div className="flex gap-2">
                      {/* Comparison operator */}
                      <Select
                        value={condition.comparison}
                        onValueChange={value =>
                          handleUpdateCondition(index, {
                            comparison:
                              value as ConditionalLogicCondition["comparison"],
                          })
                        }
                      >
                        <SelectTrigger className="flex-1 h-9 bg-transparent border-input dark:bg-slate-900/50">
                          <SelectValue placeholder="Compare operator" />
                        </SelectTrigger>
                        <SelectContent>
                          {COMPARISON_OPERATORS.map(op => (
                            <SelectItem key={op.value} value={op.value}>
                              {op.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Value input (if needed) */}
                      {needsValue(condition.comparison) && (
                        <Input
                          type="text"
                          value={conditionValueToString(condition.value)}
                          onChange={e =>
                            handleUpdateCondition(index, {
                              value: e.target.value,
                            })
                          }
                          placeholder="Value"
                          className="flex-1 h-9 bg-transparent"
                        />
                      )}
                    </div>
                  </div>

                  {/* Remove button */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleRemoveCondition(index)}
                    className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-background border border-primary/5 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove condition"
                  >
                    <span className="text-xs">×</span>
                  </Button>
                </div>
              ))
            )}
          </div>

          {/* Add condition button */}
          {availableFields.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddCondition}
              className="w-full mt-4 border-dashed"
            >
              + Add Condition
            </Button>
          ) : (
            <p className="mt-4 text-center text-xs text-amber-500 font-medium bg-amber-500/10 p-2 rounded-none border border-amber-500/20">
              Add more fields to the form to create conditions.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
