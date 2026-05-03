// Why: Advanced-tab fields for the BuilderSettingsModal. Like BasicsTab,
// renders only the fields listed in the per-kind config. PR B (2026-05-03)
// removed Use as Title (system title is always the display) and Timestamps
// (always emitted) from the UI. The i18n row stays as a disabled placeholder
// with a neutral "Coming Soon" chip. New "Show system fields" switch
// mirrors localStorage so BuiltInGroup stays in sync.
import { Input, Label, Switch } from "@revnixhq/ui";
import { useEffect, useState } from "react";

import type { AdvancedField } from "../builder-config";
import type { BuilderSettingsValues } from "../BuilderSettingsModal";

const SHOW_SYSTEM_STORAGE_KEY = "builder.showSystemInternals";

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
      {(fields.includes("adminGroup") || fields.includes("order")) && (
        // Why: admin group + order paired in a 50/50 row per feedback
        // Section 1.
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

          {fields.includes("order") && (
            <div className="space-y-1">
              <Label htmlFor="order">Order in sidebar</Label>
              <Input
                id="order"
                type="number"
                value={values.order ?? 0}
                onChange={e => set("order", Number(e.target.value))}
              />
            </div>
          )}
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
          badge="Coming Soon"
        />
      )}

      {fields.includes("showSystemFields") && <ShowSystemFieldsSwitch />}
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
            // Why: neutral disabled-chip styling (was amber, which read as
            // alarming for a future-feature placeholder).
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

/**
 * Show / hide system internals (id, createdAt, updatedAt) in the field
 * list. Stored as a global localStorage pref so both this switch and the
 * inline dismiss in BuiltInGroup share state. A window event keeps the
 * two surfaces in sync without a refresh.
 */
function ShowSystemFieldsSwitch() {
  // Why: default ON per Mobeen 2026-05-03 -- system internals visible by
  // default; legacy localStorage value === "false" honors an explicit user
  // dismissal across sessions.
  const [checked, setChecked] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = window.localStorage.getItem(SHOW_SYSTEM_STORAGE_KEY);
    return v === null ? true : v === "true";
  });

  // Listen for the inline BuiltInGroup dismiss button so this switch
  // updates without remounting.
  useEffect(() => {
    const onUpdate = (e: Event) => {
      setChecked((e as CustomEvent<boolean>).detail === true);
    };
    window.addEventListener("builder:show-system-fields", onUpdate);
    return () =>
      window.removeEventListener("builder:show-system-fields", onUpdate);
  }, []);

  const set = (next: boolean) => {
    setChecked(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SHOW_SYSTEM_STORAGE_KEY, String(next));
      window.dispatchEvent(
        new CustomEvent("builder:show-system-fields", { detail: next })
      );
    }
  };

  return (
    <SwitchRow
      ariaLabel="Show system fields"
      label="Show system fields"
      help="Show id, createdAt, updatedAt as informational rows in the field list. Saved to your browser."
      checked={checked}
      onChange={set}
    />
  );
}
