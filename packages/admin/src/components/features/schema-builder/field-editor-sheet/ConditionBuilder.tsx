// Why: visual rule builder for FieldCondition. Replaces the JSON
// textarea on the Display tab with a 3-column row: source field
// dropdown, operator dropdown (filtered by source-field type), value
// input (varies by operator). PR E2 (2026-05-03) per feedback Section 4
// + Q6 = (b) full type-aware operators.
//
// Backwards-compat: accepts the legacy { field, equals } shape as input;
// renders it as if operator = equals. Always emits the new
// { field, operator, value } shape on change.
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@revnixhq/ui";

import * as Icons from "@admin/components/icons";

import type {
  BuilderField,
  ConditionOperator,
  ConditionRangeValue,
  FieldCondition,
} from "../types";

type Props = {
  condition: FieldCondition | undefined;
  siblingFields: readonly BuilderField[];
  readOnly?: boolean;
  onChange: (next: FieldCondition | undefined) => void;
};

// Field types eligible to be a condition source. Per Q6 = (b),
// boolean / text-style / number / date / select / radio.
const ELIGIBLE_SOURCE_TYPES = new Set([
  "checkbox",
  "toggle",
  "boolean",
  "text",
  "textarea",
  "richText",
  "email",
  "code",
  "password",
  "number",
  "date",
  "select",
  "radio",
]);

const TEXT_TYPES = new Set([
  "text",
  "textarea",
  "richText",
  "email",
  "code",
  "password",
]);
const BOOLEAN_TYPES = new Set(["checkbox", "toggle", "boolean"]);
const PICKER_TYPES = new Set(["select", "radio"]);

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
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

function operatorsFor(sourceType: string | undefined): ConditionOperator[] {
  if (!sourceType) return ["equals", "notEquals"];
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
  if (PICKER_TYPES.has(sourceType)) return ["equals", "notEquals"];
  return ["equals", "notEquals"];
}

const NO_VALUE_OPERATORS = new Set<ConditionOperator>([
  "isEmpty",
  "isNotEmpty",
  "isTrue",
  "isNotTrue",
]);

function normalizeIncoming(
  cond: FieldCondition | undefined
): FieldCondition | undefined {
  if (!cond) return undefined;
  // Why: PR E2 backwards-compat. Legacy { field, equals } shape gets
  // surfaced in the UI as { field, operator: "equals", value: equals }.
  if (!cond.operator && cond.equals !== undefined) {
    return { field: cond.field, operator: "equals", value: cond.equals };
  }
  return cond;
}

export function ConditionBuilder({
  condition,
  siblingFields,
  readOnly = false,
  onChange,
}: Props) {
  const eligible = siblingFields.filter(f => ELIGIBLE_SOURCE_TYPES.has(f.type));
  const c = normalizeIncoming(condition);

  if (!c) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={readOnly || eligible.length === 0}
        onClick={() => {
          const first = eligible[0];
          if (!first) return;
          onChange({
            field: first.name,
            operator: "equals",
            value: "",
          });
        }}
      >
        <Icons.Plus className="h-3 w-3 mr-1" />
        Add condition
      </Button>
    );
  }

  const sourceField = eligible.find(f => f.name === c.field);
  const operators = operatorsFor(sourceField?.type);
  const showValue = !NO_VALUE_OPERATORS.has(c.operator ?? "equals");

  const setField = (next: Partial<FieldCondition>) =>
    onChange({ ...c, ...next });

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">
          Show this field when:
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-muted-foreground"
          disabled={readOnly}
          onClick={() => onChange(undefined)}
        >
          Remove
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {/* Source field */}
        <Select
          value={c.field}
          disabled={readOnly}
          onValueChange={v => {
            // When source field changes, reset operator to a default
            // valid for the new source-field type.
            const next = eligible.find(f => f.name === v);
            const defaultOp = operatorsFor(next?.type)[0] ?? "equals";
            setField({ field: v, operator: defaultOp, value: "" });
          }}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Select field..." />
          </SelectTrigger>
          <SelectContent>
            {eligible.map(f => (
              <SelectItem key={f.id} value={f.name}>
                {f.label || f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Operator */}
        <Select
          value={c.operator ?? "equals"}
          disabled={readOnly}
          onValueChange={v =>
            setField({
              operator: v as ConditionOperator,
              // Reset value when switching to/from no-value operator.
              value: NO_VALUE_OPERATORS.has(v as ConditionOperator)
                ? undefined
                : "",
            })
          }
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Operator" />
          </SelectTrigger>
          <SelectContent>
            {operators.map(op => (
              <SelectItem key={op} value={op}>
                {OPERATOR_LABELS[op]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Value */}
        {showValue && (
          <ValueInput
            sourceField={sourceField}
            operator={c.operator ?? "equals"}
            value={c.value}
            disabled={readOnly}
            onChange={v => setField({ value: v })}
          />
        )}
      </div>
    </div>
  );
}

function ValueInput({
  sourceField,
  operator,
  value,
  disabled,
  onChange,
}: {
  sourceField: BuilderField | undefined;
  operator: ConditionOperator;
  value: FieldCondition["value"];
  disabled: boolean;
  onChange: (v: FieldCondition["value"]) => void;
}) {
  // between: two inputs.
  if (operator === "between") {
    const r = (value as ConditionRangeValue | undefined) ?? {
      min: "",
      max: "",
    };
    const isDate = sourceField?.type === "date";
    return (
      <div className="flex items-center gap-1">
        <Input
          type={isDate ? "date" : "number"}
          value={r.min === "" ? "" : String(r.min)}
          disabled={disabled}
          onChange={e =>
            onChange({
              min: isDate ? e.target.value : Number(e.target.value),
              max: r.max,
            })
          }
          placeholder="min"
          className="h-8 text-sm"
        />
        <Input
          type={isDate ? "date" : "number"}
          value={r.max === "" ? "" : String(r.max)}
          disabled={disabled}
          onChange={e =>
            onChange({
              min: r.min,
              max: isDate ? e.target.value : Number(e.target.value),
            })
          }
          placeholder="max"
          className="h-8 text-sm"
        />
      </div>
    );
  }

  // Picker types use a dropdown of defined options.
  if (sourceField && PICKER_TYPES.has(sourceField.type)) {
    const opts = (sourceField.options ?? []).filter(o => o.value !== "");
    return (
      <Select
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onValueChange={v => onChange(v)}
      >
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder="Pick a value" />
        </SelectTrigger>
        <SelectContent>
          {opts.map(o => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (sourceField?.type === "number") {
    // Why: value is FieldCondition["value"] which is union including
    // ConditionRangeValue (object). For the number input we only render
    // primitive numbers/strings; objects collapse to "".
    const display =
      typeof value === "number" || typeof value === "string"
        ? String(value)
        : "";
    return (
      <Input
        type="number"
        value={display}
        disabled={disabled}
        onChange={e =>
          onChange(e.target.value === "" ? "" : Number(e.target.value))
        }
        className="h-8 text-sm"
      />
    );
  }

  if (sourceField?.type === "date") {
    return (
      <Input
        type="date"
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className="h-8 text-sm"
      />
    );
  }

  // Default: text input.
  return (
    <Input
      value={typeof value === "string" ? value : ""}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      placeholder="value"
      className="h-8 text-sm"
    />
  );
}
