/**
 * Pure evaluator for FieldCondition. Returns true when the field should
 * be VISIBLE given the source field's current value, false when it
 * should be hidden. Returns true when the condition is undefined or the
 * operator is unknown (fail-open so older code doesn't hide fields it
 * doesn't understand).
 *
 * Used by the runtime FieldRenderer to gate field visibility in the
 * record-editor form, AND mirrored in the visual ConditionBuilder UI
 * so previewing a condition matches what the editor will see.
 *
 * @module lib/builder/condition-evaluator
 */
import type {
  ConditionOperator,
  ConditionRangeValue,
  FieldCondition,
} from "@admin/components/features/schema-builder/types";

/**
 * Coerce an unknown value into a string suitable for text-style
 * comparisons. Avoids the eslint `no-base-to-string` footgun where
 * `String(obj)` would silently produce "[object Object]" -- objects
 * and arrays return "" instead, since they shouldn't be condition
 * sources in the first place.
 */
function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "bigint") return v.toString();
  return "";
}

/**
 * Coerce an unknown value into a number for numeric comparisons.
 * Returns NaN for non-numeric inputs so comparisons fail closed.
 */
function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return Number.NaN;
}

/**
 * Normalize a FieldCondition that may be in the legacy `{ field, equals }`
 * shape into the canonical `{ field, operator, value }` shape.
 */
function normalize(c: FieldCondition): {
  field: string;
  operator: ConditionOperator;
  value?: FieldCondition["value"];
} {
  // Why: legacy shape (PR E2 backwards-compat) had no operator and
  // stored the comparison value in `equals`. Treat as the equals
  // operator with that value.
  if (!c.operator && c.equals !== undefined) {
    return { field: c.field, operator: "equals", value: c.equals };
  }
  return {
    field: c.field,
    operator: c.operator ?? "equals",
    value: c.value,
  };
}

/**
 * Evaluate the condition against the source field's current value.
 * Returns true => the dependent field should be visible.
 */
export function evaluateCondition(
  condition: FieldCondition | undefined,
  sourceValue: unknown
): boolean {
  if (!condition) return true;
  const { operator, value } = normalize(condition);

  const src = toStr(sourceValue);
  const tgt = toStr(value);

  switch (operator) {
    case "equals":
      return src === tgt;
    case "notEquals":
      return src !== tgt;

    case "contains":
      return src.includes(tgt);
    case "notContains":
      return !src.includes(tgt);
    case "startsWith":
      return src.startsWith(tgt);
    case "endsWith":
      return src.endsWith(tgt);

    case "isEmpty":
      return (
        sourceValue === undefined || sourceValue === null || sourceValue === ""
      );
    case "isNotEmpty":
      return !(
        sourceValue === undefined ||
        sourceValue === null ||
        sourceValue === ""
      );

    case "greaterThan":
      return toNum(sourceValue) > toNum(value);
    case "lessThan":
      return toNum(sourceValue) < toNum(value);
    case "greaterThanOrEqual":
      return toNum(sourceValue) >= toNum(value);
    case "lessThanOrEqual":
      return toNum(sourceValue) <= toNum(value);

    case "between": {
      const range = value as ConditionRangeValue | undefined;
      if (!range) return true;
      const n = toNum(sourceValue);
      return n >= toNum(range.min) && n <= toNum(range.max);
    }

    case "before":
      return new Date(src).getTime() < new Date(tgt).getTime();
    case "after":
      return new Date(src).getTime() > new Date(tgt).getTime();

    case "isTrue":
      return sourceValue === true;
    case "isNotTrue":
      return sourceValue !== true;

    default:
      // Why: fail-open. If the runtime is older than the data and
      // doesn't recognize an operator, show the field rather than
      // hide it. Hiding silently is worse than the opposite.
      return true;
  }
}
