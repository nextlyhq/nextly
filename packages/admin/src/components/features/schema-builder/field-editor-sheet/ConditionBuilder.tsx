// Why: visual rule builder for FieldCondition. Replaces the JSON textarea on
// the Display tab with a source / operator / value row.
//
// The row itself comes from the shared field-UI kit, which the form builder
// composes too; what stays here is what is specific to the schema builder —
// which field types may be a source, the legacy storage shape, and the
// single-condition chrome around it.
//
// Backwards-compat: accepts the legacy { field, equals } shape as input;
// renders it as if operator = equals. Always emits the new
// { field, operator, value } shape on change.
import { Button, Label } from "@nextlyhq/ui";

import {
  ConditionRow,
  operatorsForType,
  type ConditionSource,
  type ConditionValue,
} from "@admin/components/field-ui";
import * as Icons from "@admin/components/icons";

import type { BuilderField, FieldCondition } from "../types";

type Props = {
  condition: FieldCondition | undefined;
  siblingFields: readonly BuilderField[];
  readOnly?: boolean;
  onChange: (next: FieldCondition | undefined) => void;
};

// Field types eligible to be a condition source: boolean, text-style, number,
// date, select and radio. A relationship or media field has no scalar the
// evaluator can compare, so offering it would build a condition that never
// matches.
const ELIGIBLE_SOURCE_TYPES = new Set([
  "checkbox",
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

const PICKER_TYPES = new Set(["select", "radio"]);

function normalizeIncoming(
  cond: FieldCondition | undefined
): FieldCondition | undefined {
  if (!cond) return undefined;
  // Why: the legacy { field, equals } shape gets surfaced in the UI as
  // { field, operator: "equals", value: equals }.
  if (!cond.operator && cond.equals !== undefined) {
    return { field: cond.field, operator: "equals", value: cond.equals };
  }
  return cond;
}

/**
 * A builder field as the shared row needs to see it.
 *
 * Only choice types pass their options along: the row turns an option list
 * into a dropdown, and a text field carrying stray options would lose its free
 * text input for a list it does not actually constrain values to.
 */
function toSource(field: BuilderField): ConditionSource {
  return {
    name: field.name,
    label: field.label || field.name,
    type: field.type,
    options: PICKER_TYPES.has(field.type)
      ? (field.options ?? []).filter(option => option.value !== "")
      : undefined,
  };
}

/**
 * The row's condition in the shape this builder stores.
 *
 * The row reports a range as soon as either end is typed, since that is what
 * the author has actually entered so far. Storage wants both ends present, so
 * the missing one is written as empty rather than left off — the evaluator
 * reads an absent end as NaN and quietly stops matching, which looks like a
 * broken condition rather than an unfinished one.
 */
function toStoredCondition(next: ConditionValue): FieldCondition {
  const value =
    typeof next.value === "object" && next.value !== null
      ? { min: next.value.min ?? "", max: next.value.max ?? "" }
      : next.value;
  return { field: next.field, operator: next.operator, value };
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
            operator: operatorsForType(first.type)[0] ?? "equals",
            value: "",
          });
        }}
      >
        <Icons.Plus className="h-3 w-3 mr-1" />
        Add condition
      </Button>
    );
  }

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

      <ConditionRow
        condition={{
          field: c.field,
          // The stored shape leaves the operator optional for the legacy rows
          // `normalizeIncoming` cannot repair — one with neither `operator` nor
          // `equals`. Equality is the operator that shape always meant.
          operator: c.operator ?? "equals",
          value: c.value,
        }}
        sources={eligible.map(toSource)}
        readOnly={readOnly}
        onChange={next => onChange(next && toStoredCondition(next))}
      />
    </div>
  );
}
