// Why: Advanced flags on a single field -- Unique constraint (DB-level
// uniqueness) and Localized (placeholder until per-field i18n ships,
// mirrors the modal's i18n switch). PR E1 dropped the Index toggle
// (feedback Section 4); auto-indexing is handled at the backend layer
// in a future change. Localized badge styling switched from amber
// "Soon" to a neutral "Coming Soon" chip.
// readOnly disables every editable switch; localized stays disabled in
// every mode until i18n is real.
import { Label, Switch } from "@revnixhq/ui";

import type { BuilderField } from "../types";

type Props = {
  field: BuilderField;
  readOnly?: boolean;
  onChange: (next: BuilderField) => void;
};

export function AdvancedTab({ field, readOnly = false, onChange }: Props) {
  const adv = field.advanced ?? {};
  const setAdv = (next: Partial<NonNullable<BuilderField["advanced"]>>) =>
    onChange({ ...field, advanced: { ...adv, ...next } });

  return (
    <div className="space-y-4">
      <SwitchRow
        ariaLabel="Unique"
        label="Unique"
        help="Disallow duplicate values in this column."
        checked={adv.unique === true}
        disabled={readOnly}
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
