// Which rules a field type accepts is decided by `FIELD_TYPE_VALIDATION_RULES`
// in core, not by lists kept here. A list of type names cannot see a type it
// was not written to know about, so a plugin-contributed type used to fall
// through every branch and be offered nothing; it now inherits the rules of the
// built-in type its declared storage primitive behaves as.
//
// Rendering order is this file's own concern: rules are drawn in the order
// below rather than the order core happens to list them, so the layout stays
// stable as the vocabulary grows.
import { Input, Label } from "@nextlyhq/ui";
import type { FieldValidationRule } from "nextly/field-catalog";
import { validationRulesForFieldType } from "nextly/field-catalog";
import { useId } from "react";

import { ValidationNumberField } from "@admin/components/field-ui";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { pluginFieldTypeStorage } from "@admin/lib/builder/plugin-field-type-entries";

import type { BuilderField } from "../types";

type Props = {
  field: BuilderField;
  readOnly?: boolean;
  onChange: (next: BuilderField) => void;
};

/**
 * How each numeric rule presents and what values it admits.
 *
 * Whether a bound COUNTS things decides what it admits: a length or a row count
 * is a whole number of zero or more, while a bound on a value may legitimately
 * be fractional or negative. The kit control turns that one flag into the input
 * constraints, so every surface applies the same answer.
 */
const NUMERIC_RULES = {
  minLength: { label: "Min length", counts: true },
  maxLength: { label: "Max length", counts: true },
  minRows: { label: "Min rows", counts: true },
  maxRows: { label: "Max rows", counts: true },
  min: { label: "Min", counts: false },
  max: { label: "Max", counts: false },
} as const satisfies Partial<
  Record<FieldValidationRule, { label: string; counts: boolean }>
>;

type NumericRule = keyof typeof NUMERIC_RULES;

/** Numeric rules drawn side by side, in the order they are presented. */
const NUMERIC_PAIRS: readonly (readonly [NumericRule, NumericRule])[] = [
  ["minLength", "maxLength"],
  ["minRows", "maxRows"],
  ["min", "max"],
];

export function ValidationTab({ field, readOnly = false, onChange }: Props) {
  const branding = useBranding();
  const v = field.validation ?? {};
  const setV = (next: Partial<NonNullable<BuilderField["validation"]>>) =>
    onChange({ ...field, validation: { ...v, ...next } });

  // `required` is offered by its own control outside this tab, so it is read
  // out of the list rather than drawn twice.
  const allowed = new Set<FieldValidationRule>(
    validationRulesForFieldType(
      field.type,
      pluginFieldTypeStorage(branding.plugins, field.type)
    )
  );

  return (
    <div className="space-y-4">
      {NUMERIC_PAIRS.filter(
        ([lo, hi]) => allowed.has(lo) || allowed.has(hi)
      ).map(([lo, hi]) => (
        <div key={lo} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[lo, hi]
            .filter(rule => allowed.has(rule))
            .map(rule => (
              <ValidationNumberField
                key={rule}
                label={NUMERIC_RULES[rule].label}
                counts={NUMERIC_RULES[rule].counts}
                value={v[rule]}
                disabled={readOnly}
                onChange={(n: number | undefined) => setV({ [rule]: n })}
              />
            ))}
        </div>
      ))}

      {allowed.has("pattern") && (
        <PatternRow
          value={v.pattern}
          disabled={readOnly}
          onChange={pattern => setV({ pattern })}
        />
      )}

      {allowed.has("message") && (
        <MessageRow
          value={v.message}
          disabled={readOnly}
          describesPattern={allowed.has("pattern")}
          onChange={message => setV({ message })}
        />
      )}
    </div>
  );
}

function PatternRow({
  value,
  disabled,
  onChange,
}: {
  value: string | undefined;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Pattern</Label>
      <Input
        id={id}
        placeholder="^[a-z0-9-]+$"
        value={value ?? ""}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        Regex the value must match.
      </p>
    </div>
  );
}

function MessageRow({
  value,
  disabled,
  describesPattern,
  onChange,
}: {
  value: string | undefined;
  disabled?: boolean;
  describesPattern: boolean;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Custom error message</Label>
      <Input
        id={id}
        value={value ?? ""}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        {describesPattern
          ? "Shown when the value fails the Pattern above. Falls back to a default message if blank."
          : "Shown when the value fails validation. Falls back to a default message if blank."}
      </p>
    </div>
  );
}
