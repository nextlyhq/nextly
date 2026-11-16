/**
 * The settings a plugin field type declares, drawn in the settings panel.
 *
 * A plugin describes its type's settings as data (`contributes.fieldTypes[]
 * .settings`), checked at boot, so the panel draws them with the same
 * controls for every plugin: a text box, a number box, a switch, or a choice.
 * Each value is kept at `pluginOptions[key]` on the field, the container the
 * Builder already carries a type's own options in, so saving and loading need
 * nothing new. Settings declared for General are the type's defining settings
 * and come first there; the rest go to the tab each names.
 */
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@nextlyhq/ui";
import type { PluginFieldTypeSetting } from "nextly/field-catalog";
import type { ComponentType, JSX } from "react";
import { useId, useState } from "react";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import type {
  FieldSettingsControlProps,
  FieldSettingsTab,
  FieldTypeSettings,
} from "./types";

type DeclaredTab = NonNullable<PluginFieldTypeSetting["tab"]>;

/** The field with one declared setting set, or removed when `undefined`. */
function withSetting(
  field: BuilderField,
  key: string,
  value: unknown
): BuilderField {
  const { [key]: _previous, ...rest } = field.pluginOptions ?? {};
  void _previous;
  const options = value === undefined ? rest : { ...rest, [key]: value };
  // A container left with nothing in it is dropped, so undoing the only edit
  // returns the field to the shape it was loaded in and reads as no change.
  if (Object.keys(options).length > 0)
    return { ...field, pluginOptions: options };
  const { pluginOptions: _empty, ...withoutOptions } = field;
  void _empty;
  return withoutOptions;
}

/** One declared setting's control, reading and writing `pluginOptions[key]`. */
function DeclaredSetting({
  setting,
  field,
  readOnly,
  onChange,
}: FieldSettingsControlProps & {
  setting: PluginFieldTypeSetting;
}): JSX.Element {
  const id = useId();
  const helpId = `${id}-help`;
  const stored = field.pluginOptions?.[setting.key];
  const set = (value: unknown) =>
    onChange(withSetting(field, setting.key, value));
  const describedBy = setting.help ? helpId : undefined;

  const control = (() => {
    switch (setting.control) {
      case "boolean":
        return (
          <div className="flex items-center gap-2">
            <Switch
              id={id}
              aria-label={setting.label}
              aria-describedby={describedBy}
              checked={stored === true}
              disabled={readOnly}
              onCheckedChange={set}
            />
            {/* Off is stored as false, which the plugin can tell from never
                set; Clear takes it back to unset. */}
            {stored !== undefined && !readOnly && (
              <ClearSetting
                label={setting.label}
                onClear={() => set(undefined)}
              />
            )}
          </div>
        );
      case "number":
        return (
          <NumberSettingInput
            id={id}
            describedBy={describedBy}
            stored={typeof stored === "number" ? stored : undefined}
            readOnly={readOnly}
            onValue={set}
          />
        );
      case "select":
        return (
          <div className="flex items-center gap-2">
            <Select
              // Keyed by whether a value is chosen, so clearing it shows the
              // placeholder again rather than the last option picked.
              key={typeof stored === "string" ? "chosen" : "none"}
              value={typeof stored === "string" ? stored : undefined}
              disabled={readOnly}
              onValueChange={set}
            >
              <SelectTrigger
                id={id}
                aria-label={setting.label}
                aria-describedby={describedBy}
              >
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                {setting.options.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* A choice left unset is the plugin's default, so a chosen one can
              be taken back to that rather than only swapped for another. */}
            {typeof stored === "string" && !readOnly && (
              <ClearSetting
                label={setting.label}
                onClear={() => set(undefined)}
              />
            )}
          </div>
        );
      case "text":
        return (
          <Input
            id={id}
            aria-describedby={describedBy}
            value={typeof stored === "string" ? stored : ""}
            disabled={readOnly}
            // An emptied box removes the setting rather than storing "".
            onChange={e =>
              set(e.target.value === "" ? undefined : e.target.value)
            }
          />
        );
    }
  })();

  return (
    <div
      className={
        setting.control === "boolean" ? "flex items-start gap-3" : "space-y-1"
      }
    >
      {setting.control === "boolean" && control}
      <div className="flex-1 min-w-0 space-y-1">
        <Label htmlFor={id}>{setting.label}</Label>
        {setting.help && (
          <p id={helpId} className="text-xs text-muted-foreground">
            {setting.help}
          </p>
        )}
      </div>
      {setting.control !== "boolean" && control}
    </div>
  );
}

/**
 * A declared number, typed as text. A number input reports a value it cannot
 * parse yet (`-`, `1.`) as empty, so writing on every keystroke would clear
 * the setting and swallow the sign or the point mid-entry. The box keeps what
 * was typed, writes the number once the text is one, and removes the setting
 * when it is emptied rather than storing 0.
 */
function NumberSettingInput({
  id,
  describedBy,
  stored,
  readOnly,
  onValue,
}: {
  id: string;
  describedBy: string | undefined;
  stored: number | undefined;
  readOnly: boolean;
  onValue: (value: number | undefined) => void;
}): JSX.Element {
  const [text, setText] = useState(stored === undefined ? "" : String(stored));
  const errorId = useId();
  // Text that is not yet a number (`-`, `12x`) is never written, so the saved
  // value stays the last one that was. The box says so while it shows the
  // text, and shows the saved value again once the person leaves it.
  const unreadable = text.trim() !== "" && !Number.isFinite(Number(text));
  const shown = stored === undefined ? "" : String(stored);
  return (
    <div className="space-y-1">
      <Input
        id={id}
        inputMode="decimal"
        aria-invalid={unreadable || undefined}
        aria-describedby={
          [describedBy, unreadable ? errorId : undefined]
            .filter(Boolean)
            .join(" ") || undefined
        }
        value={text}
        disabled={readOnly}
        onChange={e => {
          const next = e.target.value;
          setText(next);
          if (next.trim() === "") {
            onValue(undefined);
            return;
          }
          const parsed = Number(next);
          if (Number.isFinite(parsed)) onValue(parsed);
        }}
        onBlur={() => {
          if (unreadable) setText(shown);
        }}
      />
      {unreadable && (
        <p id={errorId} className="text-xs text-destructive">
          Not a number, so not saved; the setting stays{" "}
          {shown === "" ? "unset" : shown}.
        </p>
      )}
    </div>
  );
}

/**
 * Takes a set value back to unset, the plugin's default. Shared by the
 * controls whose own input cannot express "unset" once a value is chosen.
 */
function ClearSetting({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}): JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`Clear ${label}`}
      onClick={onClear}
    >
      Clear
    </Button>
  );
}

/** A component drawing a fixed list of declared settings. */
function settingsList(
  settings: readonly PluginFieldTypeSetting[]
): ComponentType<FieldSettingsControlProps> {
  return function DeclaredSettings(props: FieldSettingsControlProps) {
    return (
      <div className="space-y-4">
        {settings.map(setting => (
          <DeclaredSetting key={setting.key} setting={setting} {...props} />
        ))}
      </div>
    );
  };
}

/**
 * A plugin type's settings as the panel takes a type's settings: those for
 * General as its defining settings, the rest by tab. Made once per declared
 * list, so the panel's controls keep their identity while a person types.
 */
export function declaredTypeSettings(
  settings: readonly PluginFieldTypeSetting[]
): FieldTypeSettings {
  const byTab = new Map<DeclaredTab, PluginFieldTypeSetting[]>();
  for (const setting of settings) {
    const tab = setting.tab ?? "general";
    byTab.set(tab, [...(byTab.get(tab) ?? []), setting]);
  }
  const general = byTab.get("general");
  const tabs: Partial<
    Record<FieldSettingsTab, ComponentType<FieldSettingsControlProps>>
  > = {};
  for (const tab of ["validation", "display", "advanced"] as const) {
    const list = byTab.get(tab);
    if (list) tabs[tab] = settingsList(list);
  }
  return {
    ...(general ? { defining: settingsList(general) } : {}),
    tabs,
  };
}
