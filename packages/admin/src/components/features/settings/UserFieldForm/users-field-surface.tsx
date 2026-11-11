"use client";

/**
 * The user-fields surface's configuration of the shared settings panel.
 *
 * The panel draws what every field has (label, name, description, required,
 * width, default value, placeholder, the validation rules); this module adds
 * what a user field has, and narrows what it does not keep:
 * - a dropdown's and radio group's choices, stored as label and value, and
 *   whether a dropdown takes several, fixed once the field exists;
 * - a checkbox as one yes or no, with no list of choices;
 * - a default typed as text for the types the panel's default editor does not
 *   draw (a URL, a phone number, a plugin's type);
 * - only the bounds a user field stores: lengths for text-like types, the
 *   lowest and highest value for a number;
 * - no conditions, no Width, and no Read only or Hidden switches;
 * - the name and type fixed once the field exists, since its stored values
 *   are kept under them.
 */
import { Input, Label, Switch } from "@nextlyhq/ui";
import { useCallback, useId, useState, type JSX } from "react";

import {
  FieldOptionsEditor,
  withOptionIds,
  type FieldOptionsEditorProps,
  type FieldSettingsControlProps,
  type FieldSettingsSurface,
  type FieldSettingsSurfaceControlProps,
} from "@admin/components/field-ui";

import {
  generateFieldName,
  LENGTH_BOUND_TYPES,
} from "./schemas/userFieldSchema";

/**
 * The name a label gives a new user field: lowercase letters, digits and
 * underscores, starting with a letter. A label with none of those letters
 * still gives `field`: the picker adds nothing without a name, so an empty one
 * would refuse the label outright.
 */
export function userFieldName(label: string): string {
  const name = generateFieldName(label).replace(/^[^a-z]+/, "");
  return name || (label.trim() ? "field" : "");
}

/** Why a saved user field's name and type cannot change. */
const FIXED_IDENTITY_REASON =
  "A user field's name and type cannot change once the field exists, since its stored values are kept under them. For another, create a new field.";

/** Why a saved dropdown's "several choices" cannot change. */
const FIXED_SEVERAL_REASON =
  "Fixed once the field exists, since it decides how the values are stored.";

/** The types whose default the panel's own default editor draws. */
const PANEL_DEFAULT_TYPES = new Set([
  "text",
  "textarea",
  "email",
  "number",
  "date",
  "checkbox",
  "select",
  "radio",
]);

type KitOption = FieldOptionsEditorProps["options"][number];

/**
 * A dropdown's or radio group's choices, and whether a dropdown takes
 * several. The options editor's rows carry drag ids a user field does not
 * store; the mapping back strips them.
 */
function userChoices(saved: boolean) {
  return function UserChoices({
    field,
    readOnly,
    onChange,
  }: FieldSettingsControlProps): JSX.Element {
    const [rows, setRows] = useState<KitOption[]>(() =>
      withOptionIds(field.options ?? [])
    );
    const id = useId();
    const changeRows = useCallback(
      (next: KitOption[]) => {
        setRows(next);
        onChange({
          ...field,
          options: next.map(({ label, value }) => ({ label, value })),
        });
      },
      [field, onChange]
    );
    return (
      <div className="space-y-4">
        <fieldset disabled={readOnly} className="contents">
          <FieldOptionsEditor options={rows} onOptionsChange={changeRows} />
        </fieldset>
        {field.type === "select" && (
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <Switch
                id={`${id}-several`}
                checked={field.hasMany === true}
                disabled={readOnly || saved}
                onCheckedChange={hasMany => onChange({ ...field, hasMany })}
              />
              <Label htmlFor={`${id}-several`}>Allow several choices</Label>
            </div>
            {saved && (
              <p className="text-xs text-muted-foreground">
                {FIXED_SEVERAL_REASON}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };
}

/** A default typed as text, for a type the panel's default editor skips. */
function TextDefault({
  field,
  readOnly,
  onChange,
}: FieldSettingsSurfaceControlProps): JSX.Element | null {
  const id = useId();
  if (PANEL_DEFAULT_TYPES.has(field.type)) return null;
  const value =
    typeof field.defaultValue === "string" ? field.defaultValue : "";
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Default value</Label>
      <Input
        id={id}
        value={value}
        disabled={readOnly}
        onChange={e =>
          onChange({ ...field, defaultValue: e.target.value || undefined })
        }
      />
    </div>
  );
}

/**
 * The users surface. `saved` is whether the field exists yet: its name, type
 * and a dropdown's "several choices" are fixed once it does.
 */
export function usersFieldSurface(saved: boolean): FieldSettingsSurface {
  const choices = { defining: userChoices(saved) };
  return {
    surface: "users",
    deriveName: userFieldName,
    fixed: [
      { setting: "name", when: "saved", reason: FIXED_IDENTITY_REASON },
      { setting: "type", when: "saved", reason: FIXED_IDENTITY_REASON },
    ],
    extraSettings: { general: TextDefault },
    conditions: "none",
    // The bounds a user field stores for its type, and no other rule: a rule
    // it does not keep would be set and never applied.
    validationRules: (type, allowed) => {
      const kept: readonly string[] = LENGTH_BOUND_TYPES.includes(type)
        ? ["minLength", "maxLength"]
        : type === "number"
          ? ["min", "max"]
          : [];
      return allowed.filter(rule => kept.includes(rule));
    },
    displaySwitches: false,
    // A user field stores no width: the profile form lays its fields out.
    widthSetting: false,
    // A user field's definition keeps no plugin settings: the server takes
    // none from this page, so a plugin type's own controls would save nothing.
    pluginSettings: false,
    typeSettings: { checkbox: {}, select: choices, radio: choices },
  };
}
