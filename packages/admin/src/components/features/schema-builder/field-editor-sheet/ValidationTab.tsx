// Why: validation rules vary by field type. Text-style fields (text /
// textarea / richText / email / password / code) get length and pattern.
// Numeric/date types get min/max. Repeating containers (textarea /
// richText / repeater) get minRows/maxRows. The custom error message
// applies to every type and is now labelled to make clear it's the
// regex-pattern fail message.
//
// PR E1 changes (feedback Section 4):
// - Min and Max share a 50/50 row.
// - Min length and Max length share a 50/50 row.
// - Min rows and Max rows share a 50/50 row, rendered BEFORE Pattern.
// - Custom error message helper text clarifies it's the Pattern fail
//   message.
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
          {/* Why: Min / Max length 50/50 row per feedback Section 4. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          </div>

          {/* Why: Min rows / Max rows BEFORE Pattern for repeating
              text types (textarea / richText) per feedback. */}
          {isRepeating && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="pattern">Pattern</Label>
            <Input
              id="pattern"
              placeholder="^[a-z0-9-]+$"
              value={v.pattern ?? ""}
              disabled={readOnly}
              onChange={e => setV({ pattern: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Regex the value must match.
            </p>
          </div>
        </>
      )}

      {isNum && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        </div>
      )}

      {/* Why: repeater also gets Min/Max rows but it's NOT a text type,
          so render the rows here (text-type rows render above, before
          Pattern). */}
      {isRepeating && !isText && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="custom-msg">Custom error message</Label>
        <Input
          id="custom-msg"
          value={v.message ?? ""}
          disabled={readOnly}
          onChange={e => setV({ message: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Shown when the value fails the Pattern above. Falls back to a default
          message if blank.
        </p>
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
      />
    </div>
  );
}
