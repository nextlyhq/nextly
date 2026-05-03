// Why: Admin controls how the field renders in the record-editor form —
// width (segmented control with the six existing FIELD_WIDTH_OPTIONS so
// stored values like "33%" / "66%" remain valid), position (main vs
// sidebar), readOnly + hidden toggles, and a JSON textarea for the simple
// conditional-visibility rule. A richer condition builder UI is out of
// scope for PR 1; the JSON editor is consistent with the existing
// FieldCondition shape ({ field, equals }).
import { Button, Label, Switch, Textarea } from "@revnixhq/ui";

import type {
  BuilderField,
  FIELD_POSITION_OPTIONS,
  FIELD_WIDTH_OPTIONS,
  type FieldPosition,
  type FieldWidth,
} from "../types";

type Props = {
  field: BuilderField;
  readOnly?: boolean;
  onChange: (next: BuilderField) => void;
};

export function AdminTab({ field, readOnly = false, onChange }: Props) {
  const a = field.admin ?? {};
  const setA = (next: Partial<NonNullable<BuilderField["admin"]>>) =>
    onChange({ ...field, admin: { ...a, ...next } });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Width</Label>
        <Segmented
          options={FIELD_WIDTH_OPTIONS}
          value={a.width ?? "100%"}
          disabled={readOnly}
          onChange={v => setA({ width: v as FieldWidth })}
        />
      </div>

      <div className="space-y-1">
        <Label>Position</Label>
        <Segmented
          options={FIELD_POSITION_OPTIONS}
          value={a.position ?? "main"}
          disabled={readOnly}
          onChange={v => setA({ position: v as FieldPosition })}
        />
      </div>

      <div className="flex items-center gap-3">
        <Switch
          aria-label="Read only"
          checked={a.readOnly === true}
          disabled={readOnly}
          onCheckedChange={v => setA({ readOnly: v })}
        />
        <Label>Read only</Label>
      </div>

      <div className="flex items-center gap-3">
        <Switch
          aria-label="Hidden"
          checked={a.hidden === true}
          disabled={readOnly}
          onCheckedChange={v => setA({ hidden: v })}
        />
        <Label>Hidden</Label>
      </div>

      <details className="space-y-1">
        <summary className="cursor-pointer text-sm">
          Conditional visibility
        </summary>
        <Textarea
          rows={3}
          placeholder='e.g. { "field": "status", "equals": "published" }'
          value={a.condition ? JSON.stringify(a.condition) : ""}
          disabled={readOnly}
          onChange={e => {
            // Why: parse on the fly so the user sees the effect immediately,
            // but swallow parse errors mid-typing — a half-written object
            // shouldn't blow away the previous good value.
            try {
              const parsed = e.target.value
                ? JSON.parse(e.target.value)
                : undefined;
              setA({ condition: parsed });
            } catch {
              /* keep previous condition */
            }
          }}
          className="mt-2 font-mono text-xs"
        />
      </details>
    </div>
  );
}

type SegmentOption = { value: string; label: string };

function Segmented({
  options,
  value,
  disabled,
  onChange,
}: {
  options: readonly SegmentOption[];
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex border border-border rounded-md overflow-hidden w-fit">
      {options.map(opt => (
        <Button
          key={opt.value}
          type="button"
          size="sm"
          variant={value === opt.value ? "default" : "ghost"}
          disabled={disabled}
          className="rounded-none border-0"
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
