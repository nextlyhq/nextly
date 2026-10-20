/**
 * A Filter setting's value, between the condition row a person edits and the
 * `where` a widget query sends.
 *
 * The condition row speaks the admin's operator names (`notEquals`,
 * `greaterThan`), and a widget query speaks the query's (`not_equals`,
 * `greater_than`). The stored setting is the query's, because the server
 * reads it as part of a query; this is the one translation between the two,
 * in both directions, so an edit read back shows what was saved.
 *
 * One condition: the sheet edits a single row, and a stored filter of any
 * other shape reads as none, so a person sees an empty row rather than a row
 * that misstates what the card is filtering on.
 */
import {
  operatorsForType,
  type ConditionOperatorName,
  type ConditionValue,
} from "@admin/components/field-ui";

/**
 * The operators a widget query can carry, each as the query writes it. A
 * row operator with no counterpart here (`startsWith`, `endsWith`,
 * `notContains`) is never offered.
 */
const QUERY_OPERATOR: Partial<Record<ConditionOperatorName, string>> = {
  equals: "equals",
  notEquals: "not_equals",
  contains: "contains",
  greaterThan: "greater_than",
  lessThan: "less_than",
  greaterThanOrEqual: "greater_than_equal",
  lessThanOrEqual: "less_than_equal",
  before: "less_than",
  after: "greater_than",
};

/**
 * The row's type for a source field. A source names four kinds (`string`,
 * `number`, `boolean`, `date`), and the row names field types: a string with
 * fixed choices is a choice field, and any other string is text.
 */
export function conditionTypeOf(field: {
  type: string;
  choices?: readonly unknown[];
}): string {
  if (field.type === "string") {
    return field.choices !== undefined && field.choices.length > 0
      ? "select"
      : "text";
  }
  return field.type;
}

/** The operators the row offers for a field type that a query can carry. */
export function filterOperatorsFor(
  sourceType: string | undefined
): ConditionOperatorName[] {
  return operatorsForType(sourceType).filter(
    operator =>
      QUERY_OPERATOR[operator] !== undefined ||
      operator === "between" ||
      operator === "isEmpty" ||
      operator === "isNotEmpty" ||
      operator === "isTrue" ||
      operator === "isNotTrue"
  );
}

/** The `where` a condition writes, or `undefined` when it writes none. */
export function conditionToWhere(
  condition: ConditionValue | undefined
): Record<string, unknown> | undefined {
  if (condition === undefined || condition.field === "") return undefined;
  const { field, operator, value } = condition;
  switch (operator) {
    case "isEmpty":
      return { [field]: { exists: false } };
    case "isNotEmpty":
      return { [field]: { exists: true } };
    case "isTrue":
      return { [field]: { equals: true } };
    case "isNotTrue":
      return { [field]: { not_equals: true } };
    case "between": {
      if (typeof value !== "object" || value === null) return undefined;
      const bounds: Record<string, unknown> = {};
      if (value.min !== undefined && value.min !== "") {
        bounds.greater_than_equal = value.min;
      }
      if (value.max !== undefined && value.max !== "") {
        bounds.less_than_equal = value.max;
      }
      return Object.keys(bounds).length > 0 ? { [field]: bounds } : undefined;
    }
    default: {
      const op = QUERY_OPERATOR[operator];
      if (op === undefined || value === undefined || value === "") {
        return undefined;
      }
      return { [field]: { [op]: value } };
    }
  }
}

/**
 * The condition a stored `where` reads as, or `undefined` when it is not one
 * condition the row can show. The date operators read back by the field's
 * type, since `before` and `less_than` are one query operator.
 */
export function whereToCondition(
  where: unknown,
  typeOf: (field: string) => string | undefined
): ConditionValue | undefined {
  if (!isRecord(where)) return undefined;
  const entries = Object.entries(where);
  if (entries.length !== 1) return undefined;
  const [field, test] = entries[0];
  if (!isRecord(test)) return undefined;
  const ops = Object.entries(test);
  const isDate = typeOf(field) === "date";

  if (
    ops.length === 2 &&
    "greater_than_equal" in test &&
    "less_than_equal" in test
  ) {
    return {
      field,
      operator: "between",
      value: {
        min: test.greater_than_equal as string | number,
        max: test.less_than_equal as string | number,
      },
    };
  }
  if (ops.length !== 1) return undefined;
  const [op, value] = ops[0];
  if (op === "exists") {
    return { field, operator: value === false ? "isEmpty" : "isNotEmpty" };
  }
  if (value === true && (op === "equals" || op === "not_equals")) {
    return { field, operator: op === "equals" ? "isTrue" : "isNotTrue" };
  }
  if (isDate && op === "less_than") {
    return { field, operator: "before", value: value as string };
  }
  if (isDate && op === "greater_than") {
    return { field, operator: "after", value: value as string };
  }
  const operator = (
    Object.keys(QUERY_OPERATOR) as ConditionOperatorName[]
  ).find(
    name => QUERY_OPERATOR[name] === op && name !== "before" && name !== "after"
  );
  if (operator === undefined) return undefined;
  return { field, operator, value: value as string | number | boolean };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
