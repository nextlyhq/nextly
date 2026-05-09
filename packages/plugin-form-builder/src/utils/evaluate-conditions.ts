/**
 * Conditional Logic Evaluator
 *
 * Evaluates conditional logic rules to determine field visibility in forms.
 * Used by the FormRenderer component to show/hide fields based on user input.
 *
 * @module utils/evaluate-conditions
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { evaluateConditions } from '@nextly/plugin-form-builder';
 *
 * const conditionalLogic = {
 *   enabled: true,
 *   action: 'show',
 *   operator: 'AND',
 *   conditions: [
 *     { field: 'country', comparison: 'equals', value: 'US' },
 *     { field: 'age', comparison: 'greaterThan', value: 18 },
 *   ],
 * };
 *
 * const formData = { country: 'US', age: 25 };
 * const isVisible = evaluateConditions(conditionalLogic, formData);
 * // isVisible = true (all conditions met, action is 'show')
 * ```
 */

import type { ConditionalLogic, ConditionalLogicCondition } from "../types";

// ============================================================
// Types
// ============================================================

/**
 * Comparison operators supported by the conditional logic system.
 */
export type ComparisonOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "isEmpty"
  | "isNotEmpty"
  | "greaterThan"
  | "lessThan";

// ============================================================
// Internal Helper Functions
// ============================================================

/**
 * Checks if a value is considered "empty".
 * Empty values: undefined, null, empty string, empty array.
 */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string" && value.trim() === "") {
    return true;
  }
  if (Array.isArray(value) && value.length === 0) {
    return true;
  }
  return false;
}

/**
 * Converts a value to a number for numeric comparisons.
 * Returns NaN if conversion is not possible.
 */
function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return NaN;
    }
    return Number(trimmed);
  }
  return NaN;
}

/**
 * Converts a value to a string for string comparisons.
 */
function toString(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  // Primitive (number, boolean, bigint, symbol) — safe to coerce.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- value narrowed to primitive above; rule doesn't follow control flow on unknown
  return String(value);
}

/**
 * Compares two values using the specified operator.
 *
 * @param operator - The comparison operator to use
 * @param fieldValue - The actual value from the form data
 * @param conditionValue - The expected value from the condition
 * @returns Whether the comparison is true
 */
function compareValues(
  operator: ComparisonOperator,
  fieldValue: unknown,
  conditionValue: unknown
): boolean {
  switch (operator) {
    case "equals": {
      // Strict equality for most cases
      // Handle array values (e.g., checkbox groups, multi-selects)
      if (Array.isArray(fieldValue)) {
        // If conditionValue is also an array, check for deep equality
        if (Array.isArray(conditionValue)) {
          if (fieldValue.length !== conditionValue.length) {
            return false;
          }
          return fieldValue.every((v, i) => v === conditionValue[i]);
        }
        // Check if the array contains the condition value
        return fieldValue.includes(conditionValue);
      }
      // Standard equality - string comparison for flexibility
      return toString(fieldValue) === toString(conditionValue);
    }

    case "notEquals": {
      // Inverse of equals
      if (Array.isArray(fieldValue)) {
        if (Array.isArray(conditionValue)) {
          if (fieldValue.length !== conditionValue.length) {
            return true;
          }
          return !fieldValue.every((v, i) => v === conditionValue[i]);
        }
        return !fieldValue.includes(conditionValue);
      }
      return toString(fieldValue) !== toString(conditionValue);
    }

    case "contains": {
      // Case-insensitive substring check
      const fieldStr = toString(fieldValue).toLowerCase();
      const conditionStr = toString(conditionValue).toLowerCase();

      // Handle array values - check if any element contains the substring
      if (Array.isArray(fieldValue)) {
        return fieldValue.some(v =>
          toString(v).toLowerCase().includes(conditionStr)
        );
      }

      return fieldStr.includes(conditionStr);
    }

    case "isEmpty": {
      // Check if the field value is empty
      // conditionValue is ignored for this operator
      return isEmptyValue(fieldValue);
    }

    case "isNotEmpty": {
      // Check if the field value is not empty
      // conditionValue is ignored for this operator
      return !isEmptyValue(fieldValue);
    }

    case "greaterThan": {
      // Numeric comparison with loose coercion
      const fieldNum = toNumber(fieldValue);
      const conditionNum = toNumber(conditionValue);

      // If both can be converted to numbers, use numeric comparison
      if (!Number.isNaN(fieldNum) && !Number.isNaN(conditionNum)) {
        return fieldNum > conditionNum;
      }

      // Fall back to string comparison for non-numeric values
      return toString(fieldValue) > toString(conditionValue);
    }

    case "lessThan": {
      // Numeric comparison with loose coercion
      const fieldNum = toNumber(fieldValue);
      const conditionNum = toNumber(conditionValue);

      // If both can be converted to numbers, use numeric comparison
      if (!Number.isNaN(fieldNum) && !Number.isNaN(conditionNum)) {
        return fieldNum < conditionNum;
      }

      // Fall back to string comparison for non-numeric values
      return toString(fieldValue) < toString(conditionValue);
    }

    default: {
      // Unknown operator - return false to be safe
      // `operator` is `never` here because the switch is exhaustive over ComparisonOperator;
      // cast to string so the diagnostic survives if a new operator is added without a case.
      console.warn(
        `[evaluateConditions] Unknown comparison operator: ${String(operator)}`
      );
      return false;
    }
  }
}

/**
 * Evaluates a single condition against the form data.
 *
 * @param condition - The condition to evaluate
 * @param formData - The current form data
 * @returns Whether the condition is met
 */
function evaluateSingleCondition(
  condition: ConditionalLogicCondition,
  formData: Record<string, unknown>
): boolean {
  const { field, comparison, value: conditionValue } = condition;

  // Get the field value from form data
  // Support nested field access with dot notation (e.g., "address.city")
  const fieldValue = getNestedValue(formData, field);

  // Evaluate the comparison
  return compareValues(comparison, fieldValue, conditionValue);
}

/**
 * Gets a nested value from an object using dot notation.
 *
 * @param obj - The object to get the value from
 * @param path - The path to the value (e.g., "address.city")
 * @returns The value at the path, or undefined if not found
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  if (!path) {
    return undefined;
  }

  // Simple case - no nesting
  if (!path.includes(".")) {
    return obj[path];
  }

  // Nested case - traverse the path
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === undefined || current === null) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

// ============================================================
// Main Evaluation Function
// ============================================================

/**
 * Evaluates conditional logic to determine field visibility.
 *
 * This is the main entry point for conditional logic evaluation.
 * It evaluates all conditions according to the logical operator (AND/OR)
 * and returns whether the field should be visible based on the action
 * (show/hide).
 *
 * @param logic - The conditional logic configuration
 * @param formData - The current form data (field values)
 * @returns Whether the field should be visible
 *
 * @example
 * ```typescript
 * // Show field when country is US AND age is over 18
 * const logic: ConditionalLogic = {
 *   enabled: true,
 *   action: 'show',
 *   operator: 'AND',
 *   conditions: [
 *     { field: 'country', comparison: 'equals', value: 'US' },
 *     { field: 'age', comparison: 'greaterThan', value: 18 },
 *   ],
 * };
 *
 * evaluateConditions(logic, { country: 'US', age: 25 }); // true
 * evaluateConditions(logic, { country: 'US', age: 15 }); // false
 * evaluateConditions(logic, { country: 'CA', age: 25 }); // false
 *
 * // Hide field when status is "completed"
 * const hideLogic: ConditionalLogic = {
 *   enabled: true,
 *   action: 'hide',
 *   operator: 'AND',
 *   conditions: [
 *     { field: 'status', comparison: 'equals', value: 'completed' },
 *   ],
 * };
 *
 * evaluateConditions(hideLogic, { status: 'completed' }); // false (hidden)
 * evaluateConditions(hideLogic, { status: 'pending' });   // true (visible)
 * ```
 *
 * @example
 * ```typescript
 * // Show field when either condition is met (OR)
 * const orLogic: ConditionalLogic = {
 *   enabled: true,
 *   action: 'show',
 *   operator: 'OR',
 *   conditions: [
 *     { field: 'role', comparison: 'equals', value: 'admin' },
 *     { field: 'role', comparison: 'equals', value: 'editor' },
 *   ],
 * };
 *
 * evaluateConditions(orLogic, { role: 'admin' });  // true
 * evaluateConditions(orLogic, { role: 'editor' }); // true
 * evaluateConditions(orLogic, { role: 'viewer' }); // false
 * ```
 */
export function evaluateConditions(
  logic: ConditionalLogic | undefined,
  formData: Record<string, unknown>
): boolean {
  // If no logic provided or logic is disabled, field is visible by default
  if (!logic || !logic.enabled) {
    return true;
  }

  const { action, operator, conditions } = logic;

  // If no conditions, field is visible by default
  if (!conditions || conditions.length === 0) {
    return true;
  }

  // Evaluate all conditions
  const results = conditions.map(condition =>
    evaluateSingleCondition(condition, formData)
  );

  // Combine results based on logical operator
  let conditionsMet: boolean;

  if (operator === "OR") {
    // OR: At least one condition must be true
    conditionsMet = results.some(result => result);
  } else {
    // AND (default): All conditions must be true
    conditionsMet = results.every(result => result);
  }

  // Apply the action
  // - "show": field is visible when conditions are met
  // - "hide": field is visible when conditions are NOT met
  if (action === "hide") {
    return !conditionsMet;
  }

  // Default action is "show"
  return conditionsMet;
}

/**
 * Checks if a comparison operator is valid.
 *
 * @param operator - The operator to check
 * @returns Whether the operator is valid
 */
export function isValidComparisonOperator(
  operator: string
): operator is ComparisonOperator {
  const validOperators: ComparisonOperator[] = [
    "equals",
    "notEquals",
    "contains",
    "isEmpty",
    "isNotEmpty",
    "greaterThan",
    "lessThan",
  ];
  return validOperators.includes(operator as ComparisonOperator);
}

/**
 * Gets the list of supported comparison operators.
 *
 * @returns Array of supported operator names
 */
export function getSupportedComparisonOperators(): ComparisonOperator[] {
  return [
    "equals",
    "notEquals",
    "contains",
    "isEmpty",
    "isNotEmpty",
    "greaterThan",
    "lessThan",
  ];
}
