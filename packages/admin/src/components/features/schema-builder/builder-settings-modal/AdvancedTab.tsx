// Advanced-tab fields for the BuilderSettingsModal. Like BasicsTab, renders
// only the fields listed in the per-kind config.
//
// Use as Title and Timestamps are absent from THIS tab, not from the product.
// Both remain code-first collection options — `admin.useAsTitle` is what the
// entry table picks its title column from, and `timestamps` defaults to true
// in `defineCollection`. What the Visual Schema Builder declines to offer is a control
// for them: a builder-made entity takes the defaults, and a reader who needs to
// change either edits the collection config. The i18n switch is gated on
// the app-level
// `localization` config: enabling it without that config splits the entity's
// storage into a shape the runtime cannot write to (the server rejects the
// save too — this keeps the trap out of the UI). Show system fields switch
// mirrors Group + Order from the Advanced tab; server-side admin.group /
// admin.order still work for code-first config.
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@nextlyhq/ui";
import { useEffect, useState } from "react";

import { useLocalization } from "@admin/hooks/useLocalization";

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

  // The i18n switch needs the app-level `localization` config to mean
  // anything: without it the save is rejected server-side, so the switch is
  // disabled with instructions instead of offering a toggle that cannot work.
  // An entity that is ALREADY localized keeps an enabled switch so it can be
  // turned off.
  const { locales } = useLocalization();
  const i18nConfigured = locales.length > 0;
  const i18nLocked = !i18nConfigured && values.i18n !== true;

  return (
    <div className="space-y-4 py-2">
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
          help={
            i18nLocked
              ? "Requires a `localization` block (locales + defaultLocale) in nextly.config. Add it and restart the dev server to enable per-language content."
              : "Store translatable fields per language. Text fields localize by default; toggle each field's Localized setting to override. Applying this runs a migration to create the translations table."
          }
          checked={values.i18n ?? false}
          onChange={v => set("i18n", v)}
          disabled={i18nLocked}
          badge={i18nLocked ? "Not configured" : undefined}
        />
      )}

      {fields.includes("versions") && (
        <div className="space-y-3">
          <SwitchRow
            ariaLabel="Version history"
            label="Version history"
            help="Record every save so earlier versions can be previewed and restored. Turning it off keeps the versions already recorded but stops new ones; it does not add drafts."
            checked={values.versions ?? false}
            onChange={v => set("versions", v)}
          />
          {/* Retention, shown only when history is on: how many durable versions
              to keep per document. */}
          {values.versions === true && (
            <RetentionField
              value={values.versionsMaxPerDoc}
              onChange={v => set("versionsMaxPerDoc", v)}
            />
          )}
        </div>
      )}

      {fields.includes("revalidate") && (
        // Revalidation defaults ON, so the switch is checked unless the value is
        // explicitly false; turning it off stops this entity from busting cache
        // tags on write.
        <SwitchRow
          ariaLabel="Cache revalidation"
          label="Cache revalidation"
          help="Bust cached pages when an entry changes so published edits appear without a redeploy. On by default; turn off for content that never renders on cached pages."
          checked={values.revalidate ?? true}
          onChange={v => set("revalidate", v)}
        />
      )}

      {fields.includes("webhooks") && (
        // Recording defaults ON, so the switch is checked unless the value is
        // explicitly false; turning it off keeps this entity's writes out of
        // the webhook outbox and therefore out of every delivery.
        <SwitchRow
          ariaLabel="Webhook recording"
          label="Webhook recording"
          help="Send this entity's changes to subscribed webhook endpoints. On by default; turn it off for content that holds personal data, such as form submissions, so payloads never leave your app."
          checked={values.webhooks ?? true}
          onChange={v => set("webhooks", v)}
        />
      )}

      {fields.includes("showSystemFields") && <ShowSystemFieldsSwitch />}
    </div>
  );
}

/**
 * Version retention control. The stored value is a tri-state — `false`
 * (unlimited), a number (keep that many), or undefined (the default, 50) — so
 * the mode is a named select and the count only appears for "Keep last N".
 *
 * A local text mirror lets the number field be emptied mid-edit without the
 * mode snapping back; a blank field commits as the default 50 rather than an
 * invalid count.
 */
function RetentionField({
  value,
  onChange,
}: {
  value: number | false | undefined;
  onChange: (v: number | false | undefined) => void;
}) {
  // Mode is explicit state, not derived from `value`: a blank custom field
  // commits the default (undefined), and deriving the mode from that would snap
  // the select back to "Keep default" and hide the input the user is typing in.
  const [mode, setMode] = useState<"all" | "default" | "custom">(
    value === false ? "all" : typeof value === "number" ? "custom" : "default"
  );

  const [customText, setCustomText] = useState(
    typeof value === "number" ? String(value) : "50"
  );
  // Keep the field in sync when a concrete count arrives from outside, e.g.
  // loading an existing schema into the dialog.
  useEffect(() => {
    if (typeof value === "number") setCustomText(String(value));
  }, [value]);

  const onMode = (next: "all" | "default" | "custom") => {
    setMode(next);
    if (next === "all") onChange(false);
    else if (next === "default") onChange(undefined);
    else {
      const n = customText === "" ? 50 : Number(customText);
      onChange(Number.isInteger(n) && n >= 0 ? n : 50);
    }
  };

  const onCount = (text: string) => {
    setCustomText(text);
    // Only a valid non-negative integer is committed; a blank or invalid entry
    // (mid-edit "", "-1", "20.5") leaves the last valid cap in place. Committing
    // a fallback here would let clearing-then-typing-invalid silently drop a cap
    // above the default down to the default and enable unintended pruning. To
    // choose the default or unlimited, the user picks that mode in the select.
    const n = Number(text);
    if (text !== "" && Number.isInteger(n) && n >= 0) onChange(n);
  };

  const onBlur = () => {
    // Snap the visible text back to the committed value once editing ends, so a
    // save can never persist a cap different from what is shown: an invalid or
    // blank entry is not committed, and the modal's Save is not a form submit,
    // so the input's min/step never reject it on their own.
    setCustomText(typeof value === "number" ? String(value) : "50");
  };

  return (
    <div className="ml-9 space-y-2">
      <Label htmlFor="versions-retention" className="text-xs font-medium">
        Retention
      </Label>
      <Select
        value={mode}
        onValueChange={(next: "all" | "default" | "custom") => onMode(next)}
      >
        <SelectTrigger id="versions-retention" className="h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Keep default (50)</SelectItem>
          <SelectItem value="all">Keep all history</SelectItem>
          <SelectItem value="custom">Keep last N…</SelectItem>
        </SelectContent>
      </Select>
      {mode === "custom" && (
        <div className="space-y-1">
          <Input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={customText}
            onChange={e => onCount(e.target.value)}
            onBlur={onBlur}
            className="h-8 text-sm"
            aria-label="Versions to keep per document"
          />
          <p className="text-xs text-muted-foreground">
            Older versions are pruned beyond this count. 0 keeps only protected
            versions (the current one and the latest published).
          </p>
        </div>
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
            // Why: neutral disabled-chip styling (was amber, which read as
            // alarming for a future-feature placeholder).
            <span className="text-xs border border-border bg-muted text-muted-foreground rounded-sm px-1.5 py-0.5">
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
 * inline dismiss in SystemFieldsRow share state. A window event keeps the
 * two surfaces in sync without a refresh.
 */
function ShowSystemFieldsSwitch() {
  // Why: default ON  system internals visible by
  // default; legacy localStorage value === "false" honors an explicit user
  // dismissal across sessions.
  const [checked, setChecked] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = window.localStorage.getItem(SHOW_SYSTEM_STORAGE_KEY);
    return v === null ? true : v === "true";
  });

  // Listen for the inline SystemFieldsRow dismiss button so this switch
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
