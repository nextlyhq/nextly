// Why: Advanced flags on a single field. PR E1 dropped Index. PR E3
// adds the "unique disabled when nested inside a repeating container"
// rule (Q9 + brainstorm Option B 2026-05-04). The disabled state is
// driven by an `isInsideRepeatingAncestor` prop computed at the page
// level via the helper in lib/builder/is-inside-repeating-ancestor.
import { Label, Switch } from "@revnixhq/ui";

import type { BuilderField } from "../types";

type Props = {
  field: BuilderField;
  readOnly?: boolean;
  /**
   * PR E3: when true, the `unique` switch is disabled with an
   * explanatory tooltip. Computed page-side via
   * isInsideRepeatingAncestor(fieldId, allFields). Repeater rows and
   * repeatable component instances multiply, so a column-level UNIQUE
   * constraint applies across the whole table -- almost never what
   * the author meant.
   */
  isInsideRepeatingAncestor?: boolean;
  onChange: (next: BuilderField) => void;
};

const NESTED_UNIQUE_TOOLTIP =
  "Unique can't be enforced inside a repeater or repeatable component. The constraint would apply across the whole table, not per row. For per-row uniqueness, use code-first config.";

export function AdvancedTab({
  field,
  readOnly = false,
  isInsideRepeatingAncestor = false,
  onChange,
}: Props) {
  const adv = field.advanced ?? {};
  const setAdv = (next: Partial<NonNullable<BuilderField["advanced"]>>) =>
    onChange({ ...field, advanced: { ...adv, ...next } });

  const uniqueDisabled = readOnly || isInsideRepeatingAncestor;

  return (
    <div className="space-y-4">
      <SwitchRow
        ariaLabel="Unique"
        label="Unique"
        help={
          isInsideRepeatingAncestor
            ? NESTED_UNIQUE_TOOLTIP
            : "Disallow duplicate values in this column."
        }
        checked={adv.unique === true}
        disabled={uniqueDisabled}
        onChange={v => setAdv({ unique: v })}
      />
      <SwitchRow
        ariaLabel="Localized"
        label="Localized"
        help="Store different values per locale."
        checked={false}
        disabled
        badge="Coming Soon"
        onChange={() => {}}
      />
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
  badge,
}: {
  ariaLabel: string;
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <Label>{label}</Label>
          {badge && (
            // PR E1: neutral disabled-chip styling instead of amber.
            // Mirrors the Settings modal's Advanced tab from PR B so the
            // visual language is consistent across the admin.
            <span className="text-[10px] border border-border bg-muted text-muted-foreground rounded-sm px-1.5 py-0.5">
              {badge}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{help}</div>
      </div>
    </div>
  );
}
