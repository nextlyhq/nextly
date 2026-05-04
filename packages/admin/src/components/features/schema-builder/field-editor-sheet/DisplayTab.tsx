// Why: Display controls how the field renders in the record-editor form.
// PR E1 changes (feedback Section 4):
// - Renamed from AdminTab.tsx: "Admin" was jargon; "Display" is clearer.
// - Removed the Position field (no Sidebar support anywhere; the
//   single-column main layout is the only option).
// - Read-only + Hidden share a 50/50 row with helper taglines.
// - Width segmented control gains visible dividers between options.
// - Conditional visibility stays as the JSON textarea here; PR E2 will
//   rebuild it into a visual rule builder.
import { Button, Label, Switch } from "@revnixhq/ui";

import {
  FIELD_WIDTH_OPTIONS,
  type BuilderField,
  type FieldCondition,
  type FieldWidth,
} from "../types";

import { ConditionBuilder } from "./ConditionBuilder";

type Props = {
  field: BuilderField;
  /**
   * PR E2: full sibling fields so ConditionBuilder can look up each
   * one's type for the operator filter.
   */
  siblingFields: readonly BuilderField[];
  readOnly?: boolean;
  onChange: (next: BuilderField) => void;
};

export function DisplayTab({
  field,
  siblingFields,
  readOnly = false,
  onChange,
}: Props) {
  const a = field.admin ?? {};
  const setA = (next: Partial<NonNullable<BuilderField["admin"]>>) =>
    onChange({ ...field, admin: { ...a, ...next } });

  // PR H feedback 2.2: when there's no condition yet, show "+ Add
  // Condition" button. Click seeds an empty condition object so the
  // ConditionBuilder mounts (and the user picks source / operator /
  // value from there). Removing the condition (via ConditionBuilder's
  // internal "Remove" affordance) clears it back to undefined,
  // restoring the button.
  const hasCondition = field.admin?.condition !== undefined;
  const handleAddCondition = () => {
    setA({
      condition: { field: "", operator: "equals", value: "" },
    });
  };

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

      {/* PR H feedback 2.2: Read-only and Hidden each on their own
          full-width row (was 50/50 grid in PR E1). */}
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

      {/* PR H feedback 2.2: Conditional Visibility as label+button row
          (was a `<details>` accordion). When no condition exists,
          show "+ Add Condition" button. When set, render the
          ConditionBuilder inline. */}
      <div className="space-y-2">
        <Label>Conditional Visibility</Label>
        {hasCondition ? (
          <ConditionBuilder
            condition={field.admin?.condition}
            siblingFields={siblingFields.filter(f => f.id !== field.id)}
            readOnly={readOnly}
            onChange={(next: FieldCondition | undefined) =>
              setA({ condition: next })
            }
          />
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={readOnly}
            onClick={handleAddCondition}
          >
            + Add Condition
          </Button>
        )}
      </div>
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
