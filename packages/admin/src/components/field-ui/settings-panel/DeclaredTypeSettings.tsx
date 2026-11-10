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
import { useId } from "react";

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
  return {
    ...field,
    pluginOptions: value === undefined ? rest : { ...rest, [key]: value },
  };
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
          <Switch
            id={id}
            aria-label={setting.label}
            aria-describedby={describedBy}
            checked={stored === true}
            disabled={readOnly}
            onCheckedChange={set}
          />
        );
      case "number":
        return (
          <Input
            id={id}
            type="number"
            aria-describedby={describedBy}
            value={typeof stored === "number" ? String(stored) : ""}
            disabled={readOnly}
            // An emptied box removes the setting rather than storing 0.
            onChange={e =>
              set(e.target.value === "" ? undefined : Number(e.target.value))
            }
          />
        );
      case "select":
        return (
          <Select
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
