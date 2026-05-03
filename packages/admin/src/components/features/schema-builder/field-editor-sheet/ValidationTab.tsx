// Why: validation rules vary by field type. Text-style fields (text /
// textarea / richText / email / password / code) get length and pattern.
// Numeric/date types get min/max. Repeating containers (textarea /
// richText / repeater) get minRows/maxRows. The custom error message
// applies to every type. readOnly disables every input so code-first
// collections can be inspected but not changed.
import { Input, Label } from "@revnixhq/ui";

import type { BuilderField } from "../types";

type Props = {
  field: BuilderField;
  readOnly?: boolean;
  onChange: (next: BuilderField) => void;
};

const TEXT_TYPES = new Set([
  "text",
  "textarea",
  "richText",
  "email",
  "password",
  "code",
]);
const NUMERIC_TYPES = new Set(["number", "date"]);
const REPEATING_TYPES = new Set(["textarea", "richText", "repeater"]);

export function ValidationTab({ field, readOnly = false, onChange }: Props) {
  const v = field.validation ?? {};
  const setV = (next: Partial<NonNullable<BuilderField["validation"]>>) =>
    onChange({ ...field, validation: { ...v, ...next } });

  const isText = TEXT_TYPES.has(field.type);
  const isNum = NUMERIC_TYPES.has(field.type);
  const isRepeating = REPEATING_TYPES.has(field.type);

  return (
    <div className="space-y-4">
      {isText && (
        <>
          <NumberRow
            label="Min length"
            value={v.minLength}
            disabled={readOnly}
            onChange={n => setV({ minLength: n })}
          />
          <NumberRow
            label="Max length"
            value={v.maxLength}
            disabled={readOnly}
            onChange={n => setV({ maxLength: n })}
          />
          <div className="space-y-1">
            <Label htmlFor="pattern">Pattern</Label>
            <Input
              id="pattern"
              placeholder="^[a-z0-9-]+$"
              value={v.pattern ?? ""}
              disabled={readOnly}
              onChange={e => setV({ pattern: e.target.value })}
            />
          </div>
        </>
      )}

      {isNum && (
        <>
          <NumberRow
            label="Min"
            value={v.min}
            disabled={readOnly}
            onChange={n => setV({ min: n })}
          />
          <NumberRow
            label="Max"
            value={v.max}
            disabled={readOnly}
            onChange={n => setV({ max: n })}
          />
        </>
      )}

      {isRepeating && (
        <>
          <NumberRow
            label="Min rows"
            value={v.minRows}
            disabled={readOnly}
            onChange={n => setV({ minRows: n })}
          />
          <NumberRow
            label="Max rows"
            value={v.maxRows}
            disabled={readOnly}
            onChange={n => setV({ maxRows: n })}
          />
        </>
      )}

      <div className="space-y-1">
        <Label htmlFor="custom-msg">Custom error message</Label>
        <Input
          id="custom-msg"
          value={v.message ?? ""}
          disabled={readOnly}
          onChange={e => setV({ message: e.target.value })}
        />
      </div>
    </div>
  );
}

function NumberRow({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number | undefined;
  disabled?: boolean;
  onChange: (n: number | undefined) => void;
}) {
  // Stable id per row so <Label htmlFor> wires to the correct input across
  // re-renders without colliding with sibling rows.
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        value={value ?? ""}
        disabled={disabled}
        onChange={e =>
          onChange(e.target.value === "" ? undefined : Number(e.target.value))
        }
        className="max-w-[160px]"
      />
    </div>
  );
}
