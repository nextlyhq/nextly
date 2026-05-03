// Why: Display controls how the field renders in the record-editor form.
// PR E1 changes (feedback Section 4):
// - Renamed from AdminTab.tsx: "Admin" was jargon; "Display" is clearer.
// - Removed the Position field (no Sidebar support anywhere; the
//   single-column main layout is the only option).
// - Read-only + Hidden share a 50/50 row with helper taglines.
// - Width segmented control gains visible dividers between options.
// - Conditional visibility stays as the JSON textarea here; PR E2 will
//   rebuild it into a visual rule builder.
import { Button, Label, Switch, Textarea } from "@revnixhq/ui";

import {
  FIELD_WIDTH_OPTIONS,
  type BuilderField,
  type FieldWidth,
} from "../types";

type Props = {
  field: BuilderField;
  readOnly?: boolean;
  onChange: (next: BuilderField) => void;
};

export function DisplayTab({ field, readOnly = false, onChange }: Props) {
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

      {/* PR E1: Read-only + Hidden side-by-side in a 50/50 row with
          helper taglines explaining what each does. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SwitchRow
          ariaLabel="Read only"
          label="Read only"
          help="Displayed but cannot be edited."
          checked={a.readOnly === true}
          disabled={readOnly}
          onChange={v => setA({ readOnly: v })}
        />
        <SwitchRow
          ariaLabel="Hidden"
          label="Hidden"
          help="Not shown in the record editor."
          checked={a.hidden === true}
          disabled={readOnly}
          onChange={v => setA({ hidden: v })}
        />
      </div>

      <details className="space-y-1">
        <summary className="cursor-pointer text-sm">
          Conditional visibility
        </summary>
        {/* PR E2 (next) replaces this JSON textarea with a visual rule
            builder. For now we keep the existing behavior so the field
            stays editable end-to-end. */}
        <Textarea
          rows={3}
          placeholder='e.g. { "field": "status", "equals": "published" }'
          value={a.condition ? JSON.stringify(a.condition) : ""}
          disabled={readOnly}
          onChange={e => {
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
    // PR E1: visible dividers between options. The bordered wrapper +
    // `divide-x` Tailwind utility on the inner row gives a subtle
    // separator between every segmented option.
    <div className="flex border border-border rounded-md overflow-hidden divide-x divide-border w-fit">
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

function SwitchRow({
  ariaLabel,
  label,
  help,
  checked,
  onChange,
  disabled,
}: {
  ariaLabel: string;
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
      <div className="flex-1 min-w-0">
        <Label className="text-sm font-medium">{label}</Label>
        <div className="text-xs text-muted-foreground">{help}</div>
      </div>
    </div>
  );
}
