// Why: Advanced-tab fields for the BuilderSettingsModal. Like BasicsTab,
// renders only the fields listed in the per-kind config. The Status switch
// is the new Draft/Published toggle wired to the per-collection/single
// `status` boolean (covered end-to-end in Task 7's schema infrastructure).
// The i18n row is intentionally a disabled switch with a "Soon" badge —
// the toggle is reserved so visual layout is stable when i18n ships.
import { Input, Label, Switch } from "@revnixhq/ui";

import type { AdvancedField } from "../builder-config";
import type { BuilderSettingsValues } from "../BuilderSettingsModal";

type Props = {
  fields: readonly AdvancedField[];
  values: BuilderSettingsValues;
  onChange: (next: BuilderSettingsValues) => void;
};

export function AdvancedTab({ fields, values, onChange }: Props) {
  const set = <K extends keyof BuilderSettingsValues>(
    key: K,
    value: BuilderSettingsValues[K]
  ) => onChange({ ...values, [key]: value });

  return (
    <div className="space-y-4 py-2">
      {fields.includes("adminGroup") && (
        <div className="space-y-1">
          <Label htmlFor="adminGroup">Admin group</Label>
          <Input
            id="adminGroup"
            value={values.adminGroup ?? ""}
            onChange={e => set("adminGroup", e.target.value)}
            placeholder="e.g. Content"
          />
        </div>
      )}

      {fields.includes("category") && (
        <div className="space-y-1">
          <Label htmlFor="category">Category</Label>
          <Input
            id="category"
            value={values.category ?? ""}
            onChange={e => set("category", e.target.value)}
            placeholder="e.g. Layout"
          />
        </div>
      )}

      {fields.includes("order") && (
        <div className="space-y-1">
          <Label htmlFor="order">Order in sidebar</Label>
          <Input
            id="order"
            type="number"
            value={values.order ?? 0}
            onChange={e => set("order", Number(e.target.value))}
            className="max-w-[120px]"
          />
        </div>
      )}

      {fields.includes("useAsTitle") && (
        <div className="space-y-1">
          <Label htmlFor="useAsTitle">Use as title</Label>
          <Input
            id="useAsTitle"
            value={values.useAsTitle ?? "title"}
            onChange={e => set("useAsTitle", e.target.value)}
            placeholder="title"
          />
        </div>
      )}

      {fields.includes("status") && (
        <SwitchRow
          ariaLabel="Status"
          label="Status (Draft / Published)"
          help="Records get a status column. Public callers see only published."
          checked={values.status ?? false}
          onChange={v => set("status", v)}
        />
      )}

      {fields.includes("i18n") && (
        <SwitchRow
          ariaLabel="Internationalization"
          label="Internationalization"
          help="Per-locale field values."
          checked={false}
          onChange={() => {}}
          disabled
          badge="Soon"
        />
      )}

      {fields.includes("timestamps") && (
        <SwitchRow
          ariaLabel="Timestamps"
          label="Timestamps"
          help="Adds createdAt and updatedAt columns."
          checked={values.timestamps ?? true}
          onChange={v => set("timestamps", v)}
        />
      )}
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
          <span className="text-sm font-medium">{label}</span>
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
