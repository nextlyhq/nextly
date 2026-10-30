"use client";

/**
 * A setting drawn by its own editor: the component its widget names in the
 * setting's `editor`, in place of the field the setting would otherwise be
 * drawn with. It is handed what `SettingEditorProps` says: the setting's
 * value in the sheet and a way to change it, the card's other settings as the
 * sheet holds them now, and whether the sheet is saving. A change is the
 * form's like any field's, so Done saves it with the rest, once it passes the
 * setting's own rules (`settingValueProblem`, the rule the layout write and
 * the card's read hold a stored value to); a value that does not is named
 * under the editor and Done keeps nothing.
 *
 * Loaded by its path through the admin's component registry, as a card's own
 * component is, and isolated the same way: an editor that throws, or one the
 * site did not register, says so in its place rather than taking the sheet
 * down.
 *
 * @module components/features/widgets/edit/SettingEditorControl
 */

import { settingValueProblem, type AnyWidgetSetting } from "nextly/config";
import type { SettingEditorProps } from "nextly/widget-result";
import type { JSX } from "react";
import { useController, useWatch } from "react-hook-form";

import { PluginSlot } from "@admin/components/shared/plugin-slot";

/** What the sheet says where an editor cannot be drawn. */
function EditorUnavailable({ label }: { label: string }): JSX.Element {
  return (
    <p className="text-sm text-muted-foreground">
      {`${label} can't be changed here: its editor isn't available.`}
    </p>
  );
}

/**
 * A value as an editor is handed it. The form holds an unset setting as `""`
 * so its built-in controls stay controlled, and `SettingEditorProps` promises
 * `undefined` for one with no value, so the sentinel never reaches an editor.
 */
function fromForm(value: unknown): unknown {
  return value === "" ? undefined : value;
}

/** A value an editor sets, as the form holds it: none as the form's `""`. */
function toForm(value: unknown): unknown {
  return value === undefined ? "" : value;
}

export function SettingEditorControl({
  setting,
  component,
  disabled,
}: {
  setting: AnyWidgetSetting;
  component: string;
  disabled: boolean;
}): JSX.Element {
  const { field, fieldState } = useController({
    name: setting.name,
    // Judged on Done, as the form judges every field: a value the setting
    // does not take is named here rather than saved and set aside later.
    rules: {
      validate: (value: unknown) =>
        settingValueProblem(setting, fromForm(value)) ?? true,
    },
  });
  // Every value in the sheet, so an editor whose choices follow another
  // setting sees that setting change as the reader changes it.
  const values = useWatch() as Record<string, unknown> | undefined;
  const label = setting.label ?? setting.name;
  const props: SettingEditorProps<unknown> = {
    name: setting.name,
    label,
    value: fromForm(field.value),
    onChange: value => field.onChange(toForm(value)),
    // The other settings with the same promise: unset is `undefined`.
    settings: Object.fromEntries(
      Object.entries(values ?? {})
        .filter(([name]) => name !== setting.name)
        .map(([name, value]) => [name, fromForm(value)])
    ),
    disabled,
  };
  const problem = fieldState.error?.message;
  return (
    <div data-testid={`setting-editor-${setting.name}`}>
      <PluginSlot
        path={component}
        props={props}
        fallback={<EditorUnavailable label={label} />}
        errorFallback={<EditorUnavailable label={label} />}
      />
      {problem === undefined ? null : (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
