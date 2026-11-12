"use client";

/**
 * The forms surface's configuration of the shared settings panel.
 *
 * The panel draws what every field has (label, name, help text, required,
 * width, default value, the validation rules, placeholder); this module adds
 * what only a form has, and narrows what a form does not honour:
 * - a dropdown's and a radio group's choices, stored as plain label and value
 *   pairs, and whether a dropdown takes several;
 * - a checkbox as one yes or no, with no list of choices;
 * - a text area's rows, a file's accepted types and several files, a date's
 *   bounds, a number's step and a hidden field's value;
 * - a file's size limit, which a form stores on the field;
 * - the form's own show-or-hide logic on several conditions, as its own tab;
 * - only the validation rules the form's checks enforce for the type;
 * - no Read only or Hidden switches, which mean something in the entry editor
 *   and nothing on a public form;
 * - a type fixed once the form has saved the field.
 *
 * Each control edits the form field through `panel-field`, so what the panel
 * has no place for is carried and written back unchanged.
 *
 * @module admin/components/builder/forms-field-surface
 */

import {
  FieldOptionsEditor,
  withOptionIds,
  type FieldOptionsEditorProps,
  type FieldSettingsConditionsProps,
  type FieldSettingsControlProps,
  type FieldSettingsSurface,
  type FieldSettingsSurfaceControlProps,
} from "@nextlyhq/plugin-sdk/admin";
import {
  Checkbox,
  FormLabelWithTooltip,
  Input,
  Label,
  Switch,
} from "@nextlyhq/ui";
import { type JSX, type ReactNode, useCallback, useState } from "react";

import type { AnyFieldValidation, AnyFormField } from "../../../types";
import { enforcedValidationRules } from "../../../utils/enforced-validation";
import { oneResponseEmailField } from "../../../utils/field-references";
import {
  comparesByEmail,
  ONE_RESPONSE_FIELD_REASON,
} from "../../../utils/one-response-field";
import { useFormBuilder } from "../../context/FormBuilderContext";

import { ConditionalLogicEditor } from "./ConditionalLogicEditor";
import { fromPanelField, toPanelField, withFormOnly } from "./panel-field";

/**
 * The name a label gives a new field: a key for the submission data, which
 * must start with a letter and hold only letters, digits and underscores.
 * "Full name" becomes `full_name`. A label with none of those letters (one in
 * Japanese, say) still gives a name, `field`, which the host makes unique on
 * the form: the picker adds nothing without a name, so an empty one would
 * refuse the label outright.
 */
export function formFieldName(label: string): string {
  const name = label
    .normalize("NFKD")
    // The accents NFKD splits off ("é" becomes "e" and a combining mark).
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "");
  return name || (label.trim() ? "field" : "");
}

/** The form field a control edits, and how it writes a change back. */
function useFormField({ field, onChange }: FieldSettingsControlProps): {
  form: AnyFormField;
  update: (changes: Partial<AnyFormField>) => void;
} {
  return {
    form: fromPanelField(field),
    update: changes => onChange(withFormOnly(field, changes)),
  };
}

/** One labelled setting, as the panel draws its own. */
function Setting({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <FormLabelWithTooltip label={label} htmlFor={id} description={help} />
      {children}
    </div>
  );
}

/** One yes-or-no setting. */
function Toggle({
  id,
  label,
  help,
  checked,
  readOnly,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  readOnly: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <Checkbox
        id={id}
        checked={checked}
        disabled={readOnly}
        onCheckedChange={value => onChange(value === true)}
      />
      <FormLabelWithTooltip label={label} htmlFor={id} description={help} />
    </div>
  );
}

type KitOption = FieldOptionsEditorProps["options"][number];

/**
 * A dropdown's or radio group's choices. The options editor works on rows
 * with ids for drag and drop, which a form does not store: they live here and
 * `panel-field` strips them on the way back.
 */
function FormChoices(props: FieldSettingsControlProps): JSX.Element {
  const { field, readOnly, onChange } = props;
  const [rows, setRows] = useState<KitOption[]>(() =>
    withOptionIds(field.options ?? [])
  );
  const changeRows = useCallback(
    (next: KitOption[]) => {
      setRows(next);
      const options = next.map(({ label, value }) => ({ label, value }));
      const form = fromPanelField({ ...field, options });
      onChange(
        toPanelField(
          {
            ...form,
            defaultValue: defaultAmong(
              form.defaultValue,
              options.map(option => option.value)
            ),
          },
          field.id
        )
      );
    },
    [field, onChange]
  );
  return (
    <div className="space-y-4">
      <fieldset disabled={readOnly} className="contents">
        <FieldOptionsEditor options={rows} onOptionsChange={changeRows} />
      </fieldset>
      {field.type === "select" && (
        <Toggle
          id={`${field.id}-several`}
          label="Allow several choices"
          help="A visitor may pick more than one option."
          checked={field.hasMany === true}
          readOnly={readOnly}
          onChange={hasMany => onChange({ ...field, hasMany })}
        />
      )}
    </div>
  );
}

/**
 * A choice field's default, kept only where its choices still hold it: a
 * default naming a choice that was removed or renamed is one the form's check
 * would refuse, so it goes rather than being saved.
 */
function defaultAmong(value: unknown, choices: readonly string[]): unknown {
  if (Array.isArray(value)) {
    const kept = value.filter(each => choices.includes(each as string));
    return kept.length > 0 ? kept : undefined;
  }
  return typeof value === "string" && !choices.includes(value)
    ? undefined
    : value;
}

/** A number input whose empty value means "not set". */
function numberOrUndefined(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** What a text area, a file, a date, a number and a hidden field add. */
function FormTypeSettings(
  props: FieldSettingsSurfaceControlProps
): JSX.Element | null {
  switch (props.field.type) {
    case "textarea":
      return <TextareaRows {...props} />;
    case "file":
      return <FileSettings {...props} />;
    case "date":
      return <DateBounds {...props} />;
    case "number":
      return <NumberStep {...props} />;
    case "hidden":
      return <HiddenValue {...props} />;
    case "email":
      return <OneResponseUse {...props} />;
    default:
      return null;
  }
}

/**
 * Whether this Email field is the one one response per email compares: chosen
 * here or in Settings, offered only while Settings compares by email and the
 * field can be compared (required, never hidden by a condition). Another
 * field is chosen to change it, so the switch is not turned off here.
 */
function OneResponseUse(props: FieldSettingsSurfaceControlProps): JSX.Element {
  const { form } = useFormField(props);
  const { settings, updateSettings } = useFormBuilder();
  const id = `${props.field.id}-one-response`;
  const byEmail = settings.oneResponse === "email";
  const chosen = byEmail && settings.oneResponseField === form.name;
  const help = !byEmail
    ? 'Only when Settings › One response per person is "One per email address".'
    : chosen
      ? "Compared for one response per person, so it stays required and always shown. Choose another Email field to change it."
      : comparesByEmail(form)
        ? "Compare this field for one response per person instead."
        : "Make it required, with no condition, to use it.";
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor={id}>Use for one response per person</Label>
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      </div>
      <Switch
        id={id}
        aria-describedby={`${id}-help`}
        checked={chosen}
        disabled={
          props.readOnly || !byEmail || chosen || !comparesByEmail(form)
        }
        onCheckedChange={on => {
          if (on) updateSettings({ oneResponseField: form.name });
        }}
      />
    </div>
  );
}

/** A text area's height. */
function TextareaRows(props: FieldSettingsSurfaceControlProps): JSX.Element {
  const { form, update } = useFormField(props);
  const rows = (form as Extract<AnyFormField, { type: "textarea" }>).rows;
  const id = `${props.field.id}-rows`;
  return (
    <Setting
      id={id}
      label="Rows"
      help="The text area's height, in lines of text."
    >
      <Input
        id={id}
        type="number"
        min={2}
        max={20}
        disabled={props.readOnly}
        value={rows ?? ""}
        onChange={e => update({ rows: numberOrUndefined(e.target.value) })}
        className="w-24"
      />
    </Setting>
  );
}

/** The first and last date a visitor may pick. */
function DateBounds(props: FieldSettingsSurfaceControlProps): JSX.Element {
  const { form, update } = useFormField(props);
  const date = form as Extract<AnyFormField, { type: "date" }>;
  const id = props.field.id;
  return (
    <div className="grid grid-cols-2 gap-4">
      <Setting
        id={`${id}-min-date`}
        label="Earliest date"
        help="The first date a visitor may pick."
      >
        <Input
          id={`${id}-min-date`}
          type="date"
          disabled={props.readOnly}
          value={date.min ?? ""}
          onChange={e => update({ min: e.target.value || undefined })}
        />
      </Setting>
      <Setting
        id={`${id}-max-date`}
        label="Latest date"
        help="The last date a visitor may pick."
      >
        <Input
          id={`${id}-max-date`}
          type="date"
          disabled={props.readOnly}
          value={date.max ?? ""}
          onChange={e => update({ max: e.target.value || undefined })}
        />
      </Setting>
    </div>
  );
}

/** How far each press of a number's arrows moves it. */
function NumberStep(props: FieldSettingsSurfaceControlProps): JSX.Element {
  const { form, update } = useFormField(props);
  const validation: AnyFieldValidation = form.validation ?? {};
  const id = `${props.field.id}-step`;
  return (
    <Setting
      id={id}
      label="Step"
      help="How far each press of the arrows moves the number, 0.01 for cents."
    >
      <Input
        id={id}
        type="number"
        disabled={props.readOnly}
        placeholder="1"
        value={validation.step ?? ""}
        onChange={e =>
          update({
            validation: {
              ...validation,
              step: numberOrUndefined(e.target.value),
            },
          })
        }
        className="w-24"
      />
    </Setting>
  );
}

/** The value a hidden field sends. */
function HiddenValue(props: FieldSettingsSurfaceControlProps): JSX.Element {
  const { form, update } = useFormField(props);
  const id = `${props.field.id}-hidden-value`;
  return (
    <Setting
      id={id}
      label="Value"
      help="Sent with every submission, without the visitor seeing it."
    >
      <Input
        id={id}
        type="text"
        disabled={props.readOnly}
        value={typeof form.defaultValue === "string" ? form.defaultValue : ""}
        onChange={e => update({ defaultValue: e.target.value || undefined })}
      />
    </Setting>
  );
}

/** A file's accepted types, and whether it takes several files. */
function FileSettings(props: FieldSettingsSurfaceControlProps): JSX.Element {
  const { form, update } = useFormField(props);
  const { readOnly } = props;
  const id = props.field.id;
  const file = form as Extract<AnyFormField, { type: "file" }>;
  return (
    <div className="space-y-4">
      <Setting
        id={`${id}-accept`}
        label="Accepted file types"
        help="File types a visitor may upload, separated by commas, such as image/* or application/pdf."
      >
        <Input
          id={`${id}-accept`}
          type="text"
          disabled={readOnly}
          placeholder="image/*,application/pdf"
          value={file.accept ?? ""}
          onChange={e => update({ accept: e.target.value || undefined })}
        />
      </Setting>
      <Toggle
        id={`${id}-multiple`}
        label="Allow several files"
        help="A visitor may upload more than one file."
        checked={file.multiple === true}
        readOnly={readOnly}
        onChange={multiple => update({ multiple })}
      />
      {/* Which notifications carry its files is chosen on each
          notification's page (Attach files from); a field's earlier switch
          stays stored as what a notification saved before attaches. */}
    </div>
  );
}

/** A file's size limit, which a form stores on the field. */
function FileSizeSetting(
  props: FieldSettingsSurfaceControlProps
): JSX.Element | null {
  const { form, update } = useFormField(props);
  if (form.type !== "file") return null;
  const file = form as Extract<AnyFormField, { type: "file" }>;
  const id = `${props.field.id}-max-size`;
  return (
    <Setting
      id={id}
      label="Largest file (bytes)"
      help="The size a file may not exceed; 10485760 is 10 MB."
    >
      <Input
        id={id}
        type="number"
        min={0}
        disabled={props.readOnly}
        placeholder="10485760"
        value={file.maxFileSize ?? ""}
        onChange={e =>
          update({ maxFileSize: numberOrUndefined(e.target.value) })
        }
      />
    </Setting>
  );
}

/**
 * The form's own show-or-hide logic, on any number of conditions joined by
 * all or any: a shape the panel's single condition cannot hold.
 */
function FormConditions(props: FieldSettingsConditionsProps): JSX.Element {
  const { form, update } = useFormField(props);
  const { settings } = useFormBuilder();
  const siblings = props.siblings.map(fromPanelField);
  return (
    <fieldset disabled={props.readOnly} className="contents">
      <ConditionalLogicEditor
        field={form}
        allFields={siblings}
        onUpdate={update}
        // The Email field one response per email compares is always shown.
        lockedReason={
          oneResponseEmailField(settings) === form.name
            ? ONE_RESPONSE_FIELD_REASON
            : undefined
        }
      />
    </fieldset>
  );
}

/** Why a saved field's type cannot change. */
export const SAVED_TYPE_REASON =
  "A saved field keeps its type, so its answers stay readable. For another type, add a new field.";

/**
 * Why a saved field's name cannot change: its answers are stored under it, so
 * a new name would leave every earlier answer behind under the old one.
 */
export const SAVED_NAME_REASON =
  "Answers are stored under this name, so it stays as saved. For another name, add a new field.";

/** How the Form Builder configures the shared settings panel. */
export const FORMS_FIELD_SURFACE: FieldSettingsSurface = {
  surface: "forms",
  deriveName: formFieldName,
  fixed: [
    { setting: "type", when: "saved", reason: SAVED_TYPE_REASON },
    { setting: "name", when: "saved", reason: SAVED_NAME_REASON },
  ],
  extraSettings: { general: FormTypeSettings, validation: FileSizeSetting },
  conditions: FormConditions,
  // Offered only where the form's checks read the rule for that type: a rule
  // nothing enforces would let an author set a limit visitors never meet.
  validationRules: (type, allowed) => {
    const enforced = enforcedValidationRules(type);
    return allowed.filter(rule => enforced.includes(rule));
  },
  displaySwitches: false,
  typeSettings: {
    // One yes or no (a consent box, say), never a list of choices.
    checkbox: {},
    select: { defining: FormChoices },
    radio: { defining: FormChoices },
  },
};
