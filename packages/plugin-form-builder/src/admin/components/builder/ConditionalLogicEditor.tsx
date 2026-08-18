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

import {
  ConditionRow,
  type ConditionOperatorName,
  type ConditionSource,
} from "@nextlyhq/plugin-sdk/admin";
import {
  FormLabelWithTooltip,
  Button,
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { useCallback, useMemo } from "react";

import type {
  AnyFormField,
  ConditionalLogic,
  ConditionalLogicCondition,
} from "../../../types";

// ============================================================================
// Types
// ============================================================================

export interface ConditionalLogicEditorProps {
  /** The field being edited (built-in or plugin-contributed). */
  field: AnyFormField;
  /** All fields in the form (for field references) */
  allFields: AnyFormField[];
  /** Callback when conditional logic is updated */
  onUpdate: (updates: Partial<AnyFormField>) => void;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * The comparisons `evaluateConditions` implements.
 *
 * The shared row offers seventeen operators, and this runtime understands
 * seven of them. Every operator offered has to be one this evaluator can
 * answer: a field configured with `isTrue` would store fine, render fine, and
 * then never match at form time, with nothing anywhere to say why. So the
 * vocabulary is pinned here rather than taken from the row's default.
 *
 * Typed as the shared row's operator names AND as this module's stored
 * comparisons, so the day either list moves the other stops compiling.
 */
const SUPPORTED_COMPARISONS = [
  "equals",
  "notEquals",
  "contains",
  "isEmpty",
  "isNotEmpty",
  "greaterThan",
  "lessThan",
] as const satisfies readonly ConditionOperatorName[] &
  readonly ConditionalLogicCondition["comparison"][];

const SUPPORTED_SET: ReadonlySet<string> = new Set(SUPPORTED_COMPARISONS);

/**
 * Whether an operator the row reported is one this runtime can evaluate.
 *
 * `operatorsFor` already narrows what the row offers, so this should always
 * hold; it is a guard rather than an assertion so that if the two ever drift,
 * the condition is left as it was instead of stored in a shape the evaluator
 * will not understand.
 */
function isSupportedComparison(
  operator: string
): operator is ConditionalLogicCondition["comparison"] {
  return SUPPORTED_SET.has(operator);
}

// The field types whose values are text, named as `FormFieldType` spells them.
// `tel` and `password` were guesses and match nothing; the builder's telephone
// field is `phone`, so it was falling through to the full comparison set and
// offering "greater than" for a phone number.
const TEXT_TYPES = new Set([
  "text",
  "textarea",
  "email",
  "url",
  "phone",
  "hidden",
]);

/**
 * The comparisons worth offering for a source type, within what the evaluator
 * supports.
 *
 * Narrower than the full seven where the type makes some of them meaningless:
 * "contains" on a number compares substrings of a formatted value, which is
 * not what anyone building that condition means.
 */
function comparisonsForType(
  sourceType: string | undefined
): ConditionOperatorName[] {
  if (sourceType === "checkbox") return ["equals", "notEquals"];
  if (sourceType === "number") {
    return ["equals", "notEquals", "greaterThan", "lessThan"];
  }
  if (sourceType !== undefined && TEXT_TYPES.has(sourceType)) {
    return ["equals", "notEquals", "contains", "isEmpty", "isNotEmpty"];
  }
  return [...SUPPORTED_COMPARISONS];
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * A form field as the shared row needs to see it.
 *
 * Choice fields hand over their options so the value editor becomes a dropdown
 * of exactly those, rather than a text box in which an option can be misspelled
 * into a condition that never matches.
 */
function toSource(field: AnyFormField): ConditionSource {
  // Only the choice field types carry an option list, and `AnyFormField` is a
  // union over every type, so the property has to be probed rather than read.
  // An option with an empty value is dropped: a Select cannot render one, and
  // it is a placeholder row in the editor rather than a value to compare with.
  const options =
    "options" in field && Array.isArray(field.options)
      ? field.options
          .filter(option => option.value !== "")
          .map(option => ({ value: option.value, label: option.label }))
      : undefined;
  return {
    name: field.name,
    label: field.label || field.name,
    type: field.type,
    options,
  };
}

/**
 * A stored condition's value as the row edits it.
 *
 * Storage types this `unknown`, and the row edits scalars. An object that got
 * in some other way is shown as nothing rather than as `[object Object]`,
 * which is not a value anyone typed and not one the evaluator can use.
 */
function toRowValue(value: unknown): string | number | boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return undefined;
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
        // Semantic border token so this top divider is visible at the 3:1 UI minimum.
        <div className="space-y-4 pt-4 border-t border-border">
          {/* Action and operator row */}
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Select
              value={logic.action}
              onValueChange={value =>
                updateLogic({ action: value as "show" | "hide" })
              }
            >
              <SelectTrigger className="w-[100px] h-9 bg-transparent border-input dark:bg-muted/50">
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
              <SelectTrigger className="w-[80px] h-9 bg-transparent border-input dark:bg-muted/50">
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
              // Semantic border token so this empty-state boundary is visible at the 3:1 UI minimum.
              <div className="p-4 bg-muted rounded-none border border-dashed border-border text-center text-xs text-muted-foreground">
                No conditions defined. Add a condition to get started.
              </div>
            ) : (
              logic.conditions.map((condition, index) => (
                // Semantic border token so this condition card boundary is visible at the 3:1 UI minimum.
                <div
                  key={index}
                  className="flex flex-col gap-2 p-3 rounded-none bg-muted border border-border relative group"
                >
                  {/* Source, comparison and value, shared with the schema
                      builder. Stacked rather than in three columns: this card
                      sits in a builder sidebar, where three columns leave each
                      control too narrow to read its own selection. */}
                  <ConditionRow
                    className="grid grid-cols-1 gap-2"
                    condition={{
                      field: condition.field,
                      operator: condition.comparison,
                      value: toRowValue(condition.value),
                    }}
                    sources={availableFields.map(toSource)}
                    operatorsFor={comparisonsForType}
                    onChange={next => {
                      if (!next || !isSupportedComparison(next.operator))
                        return;
                      handleUpdateCondition(index, {
                        field: next.field,
                        comparison: next.operator,
                        value: toRowValue(next.value),
                      });
                    }}
                  />

                  {/* Remove button */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleRemoveCondition(index)}
                    // Semantic border token so the remove button's boundary is visible at the 3:1 UI minimum.
                    className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-background border border-border opacity-0 group-hover:opacity-100 transition-opacity"
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
            // Full-strength warning border so this notice boundary is perceivable over its tinted fill.
            // The 600 shade rather than the base token: the base measures 4.37:1
            // once its own 10% fill composites over the page container, short of
            // the 4.5:1 text needs. The 600 shade holds 5.13:1 at its worst
            // surface in either mode.
            <p className="mt-4 text-center text-xs text-warning-600 font-medium bg-warning/10 p-2 rounded-none border border-warning">
              Add more fields to the form to create conditions.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
