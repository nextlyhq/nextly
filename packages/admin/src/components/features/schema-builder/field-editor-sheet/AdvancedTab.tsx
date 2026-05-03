// Why: Advanced flags on a single field — Unique constraint (DB-level
// uniqueness), Index (separate from unique because you might want a
// non-unique index for query speed), and Localized (placeholder until
// per-field i18n ships, mirrors the modal's i18n switch).
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
        ariaLabel="Index"
        label="Index"
        help="Add a database index for faster lookups."
        checked={adv.index === true}
        disabled={readOnly}
        onChange={v => setAdv({ index: v })}
      />
      <SwitchRow
        ariaLabel="Localized"
        label="Localized"
        help="Store different values per locale."
        checked={false}
        disabled
        badge="Soon"
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
            <span className="text-[10px] border border-amber-400/40 text-amber-300 rounded-sm px-1 py-0.5">
              {badge}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{help}</div>
      </div>
    </div>
  );
}
