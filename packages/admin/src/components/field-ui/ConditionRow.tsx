"use client";

/**
 * One condition, edited as source / operator / value.
 *
 * The ROW is what two surfaces already share; the container is not. The schema
 * builder shows exactly one condition and no chrome around it, while the form
 * builder shows a list with an enable toggle, a show-or-hide action and an
 * AND/OR joiner. Extracting the container would have forced one of them to grow
 * a shape it does not want, so this owns the part that is genuinely the same
 * and each surface keeps its own.
 *
 * Deliberately neutral about the caller's field model. A surface passes
 * {@link ConditionSource}s — name, label, type — rather than its own field
 * objects, so nothing here depends on how a field is stored or what else it
 * carries. That is what lets the schema builder's `BuilderField` and the form
 * builder's `AnyFormField` reach the same component without either becoming the
 * other's problem.
 *
 * @module components/field-ui/ConditionRow
 */
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";

import { RangeField } from "@admin/components/shared/range-field";

/** Every operator a condition can use. */
export type ConditionOperatorName =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "isEmpty"
  | "isNotEmpty"
  | "greaterThan"
  | "lessThan"
  | "greaterThanOrEqual"
  | "lessThanOrEqual"
  | "between"
  | "before"
  | "after"
  | "isTrue"
  | "isNotTrue";

/**
 * The two ends of a `between` comparison.
 *
 * Named `min`/`max` because that is the shape already stored by the schema
 * builder and already read by its runtime condition evaluator. A kit that
 * invented `from`/`to` would have made every existing stored condition wrong,
 * or needed a migration, to gain nothing.
 */
export interface ConditionRange {
  min?: string | number;
  max?: string | number;
}

/** One choice a source field accepts, when it accepts a fixed set. */
export interface ConditionSourceOption {
  value: string;
  label?: string;
}

/** A field this condition may be based on, as this component needs it. */
export interface ConditionSource {
  /** The stored name, used as the condition's `field`. */
  name: string;
  /** What to show in the dropdown. Falls back to `name` when absent. */
  label?: string;
  /**
   * The field's type, which decides the operators offered and the value editor
   * shown. An unrecognised type is not an error — it gets the equality
   * operators, which every type supports.
   */
  type?: string;
  /**
   * The values this field accepts, when it accepts a fixed set.
   *
   * Given, the value editor becomes a dropdown of exactly these. A select or
   * radio field compares against one of its own options and nothing else, so
   * typing the value by hand is a way to misspell it into a condition that
   * never matches, with nothing on screen to say why.
   */
  options?: readonly ConditionSourceOption[];
}

/** One condition, in the shape this component reads and writes. */
export interface ConditionValue {
  field: string;
  operator: ConditionOperatorName;
  value?: string | number | boolean | ConditionRange;
}

export interface ConditionRowProps {
  /** The condition being edited, or undefined for an empty row. */
  condition: ConditionValue | undefined;
  /** The fields that may be chosen as the source. */
  sources: readonly ConditionSource[];
  /** Render every control disabled. */
  readOnly?: boolean;
  /**
   * Which operators to offer for a source type. Defaults to
   * {@link operatorsForType}; pass one to narrow or extend a surface's set.
   */
  operatorsFor?: (sourceType: string | undefined) => ConditionOperatorName[];
  /**
   * Layout for the three controls, replacing the default grid.
   *
   * The row is composed into containers of very different widths — a full
   * width settings tab and a narrow card in a builder sidebar — and three
   * equal columns that read well in one are cramped in the other. The surface
   * that owns the container is the only thing that knows which it is.
   */
  className?: string;
  /** Called with the edited condition, or undefined when the source clears. */
  onChange: (next: ConditionValue | undefined) => void;
}

const OPERATOR_LABELS: Record<ConditionOperatorName, string> = {
  equals: "equals",
  notEquals: "does not equal",
  contains: "contains",
  notContains: "does not contain",
  startsWith: "starts with",
  endsWith: "ends with",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  greaterThan: "is greater than",
  lessThan: "is less than",
  greaterThanOrEqual: "is greater than or equal to",
  lessThanOrEqual: "is less than or equal to",
  between: "is between",
  before: "is before",
  after: "is after",
  isTrue: "is true",
  isNotTrue: "is not true",
};

const TEXT_TYPES = new Set([
  "text",
  "textarea",
  "richText",
  "email",
  "code",
  "password",
]);
const BOOLEAN_TYPES = new Set(["checkbox", "boolean"]);
const CHOICE_TYPES = new Set(["select", "radio"]);

/**
 * The operators that make sense for a source type.
 *
 * Type-awareness is the difference between a builder that helps and one that
 * offers "is greater than" for a checkbox. An unknown type gets equality rather
 * than nothing, because every type supports it and a surface with its own field
 * types should not lose the row entirely.
 */
export function operatorsForType(
  sourceType: string | undefined
): ConditionOperatorName[] {
  if (sourceType === undefined) return ["equals", "notEquals"];
  if (BOOLEAN_TYPES.has(sourceType)) return ["isTrue", "isNotTrue"];
  if (TEXT_TYPES.has(sourceType)) {
    return [
      "equals",
      "notEquals",
      "contains",
      "notContains",
      "startsWith",
      "endsWith",
      "isEmpty",
      "isNotEmpty",
    ];
  }
  if (sourceType === "number") {
    return [
      "equals",
      "notEquals",
      "greaterThan",
      "lessThan",
      "greaterThanOrEqual",
      "lessThanOrEqual",
      "between",
    ];
  }
  if (sourceType === "date") {
    return ["equals", "notEquals", "before", "after", "between"];
  }
  if (CHOICE_TYPES.has(sourceType)) return ["equals", "notEquals"];
  return ["equals", "notEquals"];
}

/** Operators that compare against nothing, so the value editor is hidden. */
const VALUELESS_OPERATORS = new Set<ConditionOperatorName>([
  "isEmpty",
  "isNotEmpty",
  "isTrue",
  "isNotTrue",
]);

/** Whether an operator takes a value at all. */
export function operatorTakesValue(operator: ConditionOperatorName): boolean {
  return !VALUELESS_OPERATORS.has(operator);
}

function isRange(value: ConditionValue["value"]): value is ConditionRange {
  return typeof value === "object" && value !== null;
}

function rangeEnd(value: ConditionValue["value"], end: "min" | "max"): string {
  if (!isRange(value)) return "";
  const part = value[end];
  return part === undefined ? "" : String(part);
}

function scalar(value: ConditionValue["value"]): string {
  if (value === undefined || value === null) return "";
  if (isRange(value)) return "";
  return String(value);
}

export function ConditionRow({
  condition,
  sources,
  readOnly = false,
  operatorsFor = operatorsForType,
  className = "grid grid-cols-1 gap-2 sm:grid-cols-3",
  onChange,
}: ConditionRowProps) {
  const source = sources.find(entry => entry.name === condition?.field);
  const operators = operatorsFor(source?.type);
  // An operator the current source does not offer would render a Select with no
  // matching item and silently show nothing, so the row falls back to the first
  // one the source does offer. This happens whenever the source changes to a
  // type whose operator set is different.
  const operator: ConditionOperatorName =
    condition && operators.includes(condition.operator)
      ? condition.operator
      : (operators[0] ?? "equals");

  const emit = (next: Partial<ConditionValue>): void => {
    const field = next.field ?? condition?.field ?? "";
    if (field === "") {
      onChange(undefined);
      return;
    }
    onChange({
      field,
      operator: next.operator ?? operator,
      ...(next.value === undefined ? {} : { value: next.value }),
    });
  };

  const takesValue = operatorTakesValue(operator);
  const numeric = source?.type === "number";
  const dated = source?.type === "date";
  // An empty option list is treated as no list at all: a dropdown with nothing
  // in it is a dead control, and falling back to free text at least lets the
  // condition be written while the source field is still being defined. A
  // range compares two ends and never picks from the set, so it keeps its
  // inputs whatever the source offers.
  const choices =
    operator !== "between" && source?.options && source.options.length > 0
      ? source.options
      : undefined;

  return (
    <div className={className}>
      <Select
        value={condition?.field ?? ""}
        disabled={readOnly}
        onValueChange={value =>
          // The operator has to be recomputed from the NEW source, not carried
          // over. Switching a text `equals` condition to a checkbox otherwise
          // stored `equals` while the next render displayed the `isTrue` it
          // fell back to, so what was saved and what was on screen disagreed.
          emit({
            field: value,
            operator:
              operatorsFor(
                sources.find(entry => entry.name === value)?.type
              )[0] ?? "equals",
            value: undefined,
          })
        }
      >
        <SelectTrigger aria-label="Condition field">
          <SelectValue placeholder="Choose a field…" />
        </SelectTrigger>
        <SelectContent>
          {sources.map(entry => (
            <SelectItem key={entry.name} value={entry.name}>
              {entry.label ?? entry.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={operator}
        disabled={readOnly || condition === undefined}
        onValueChange={value =>
          // The value is dropped when the operator changes, because what the
          // old one held rarely fits the new one — a range is not a string, and
          // an operator that takes nothing should not carry a leftover.
          emit({ operator: value as ConditionOperatorName, value: undefined })
        }
      >
        <SelectTrigger aria-label="Condition operator">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map(name => (
            <SelectItem key={name} value={name}>
              {OPERATOR_LABELS[name]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {takesValue && operator === "between" ? (
        // Labelled rather than placeholder-hinted. These fields start empty and
        // the field border is deliberately below 1.4.11's 3:1 for controls that
        // carry other cues, so the label IS the other cue -- and a placeholder
        // cannot be it when the field is a date, because the control paints its
        // own format hint and never renders the attribute.
        <RangeField
          label="Condition value range"
          type={numeric ? "number" : dated ? "date" : "text"}
          disabled={readOnly}
          from={rangeEnd(condition?.value, "min")}
          to={rangeEnd(condition?.value, "max")}
          onFromChange={min =>
            emit({
              value: {
                ...(isRange(condition?.value) ? condition.value : {}),
                min,
              },
            })
          }
          onToChange={max =>
            emit({
              value: {
                ...(isRange(condition?.value) ? condition.value : {}),
                max,
              },
            })
          }
        />
      ) : takesValue && choices !== undefined ? (
        <Select
          value={scalar(condition?.value)}
          disabled={readOnly || condition === undefined}
          onValueChange={value => emit({ value })}
        >
          <SelectTrigger aria-label="Condition value">
            <SelectValue placeholder="Pick a value…" />
          </SelectTrigger>
          <SelectContent>
            {choices.map(choice => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label ?? choice.value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : takesValue ? (
        <Input
          type={numeric ? "number" : dated ? "date" : "text"}
          aria-label="Condition value"
          placeholder="Value"
          disabled={readOnly || condition === undefined}
          value={scalar(condition?.value)}
          onChange={event => emit({ value: event.target.value })}
        />
      ) : (
        // Nothing to compare against, so nothing to type into. The column is
        // kept rather than collapsed so a list of rows stays aligned.
        <div aria-hidden="true" />
      )}
    </div>
  );
}
