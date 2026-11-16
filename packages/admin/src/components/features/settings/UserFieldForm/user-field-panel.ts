/**
 * A user field's form values as the shared settings panel edits them, and back.
 *
 * The panel edits the admin's field definition, which spells a user field's
 * settings its own way: the description is `admin.description`, the
 * placeholder `admin.placeholder`, required and the bounds sit in
 * `validation` (`min`/`max` for a number's), and a default is a string,
 * number, boolean or date where a user field stores every default as text.
 * Whether the field is active is the page's own setting, not the panel's, so
 * it is carried past the panel unchanged.
 */
import type { FieldSettingsField } from "@admin/components/field-ui";

import type { UserFieldFormValues } from "./schemas/userFieldSchema";

/** The id the panel tells this field apart by; a page edits one field. */
const USER_FIELD_PANEL_ID = "user-field";

/** A bound as the panel holds it: a number, or none for "". */
function boundOf(text: string): number | undefined {
  if (!text.trim()) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** A bound as the form values hold it. */
function boundText(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

/**
 * A stored default the panel's editor cannot show (text in a number field,
 * "yes" for a checkbox), kept aside unchanged so that editing another setting
 * saves it as it was. A symbol, which the panel's copies of the field keep.
 */
const UNSHOWN_DEFAULT: unique symbol = Symbol("user field: unshown default");

type PanelField = FieldSettingsField & { [UNSHOWN_DEFAULT]?: string };

/** The stored default the panel's editor cannot show, if there is one. */
export function unshownDefault(field: FieldSettingsField): string | undefined {
  return (field as PanelField)[UNSHOWN_DEFAULT];
}

/** The field with that stored default let go, as clearing it says. */
export function withoutUnshownDefault(
  field: FieldSettingsField
): FieldSettingsField {
  const next: PanelField = { ...field };
  delete next[UNSHOWN_DEFAULT];
  return next;
}

/**
 * The panel's default for the stored text, in the shape its editor takes, or
 * undefined when the editor has no shape for it.
 */
function panelDefault(
  type: string,
  text: string
): FieldSettingsField["defaultValue"] {
  if (text === "") return undefined;
  if (type === "checkbox") {
    return text === "true" ? true : text === "false" ? false : undefined;
  }
  if (type === "number") {
    const value = Number(text);
    return Number.isFinite(value) ? value : undefined;
  }
  return text;
}

/**
 * The stored text for the panel's default. A date is kept as the day alone:
 * the panel's date editor writes the chosen day as its UTC midnight, and a
 * user field's date default is the day, as its input shows it.
 */
function storedDefault(field: FieldSettingsField): string {
  const value = field.defaultValue;
  if (value === undefined || value === null) {
    return (field as PanelField)[UNSHOWN_DEFAULT] ?? "";
  }
  if (typeof value !== "string") return String(value);
  return field.type === "date" && /^\d{4}-\d{2}-\d{2}T/.test(value)
    ? value.slice(0, 10)
    : value;
}

/**
 * A choice field's default only while one of its options still has it: the
 * panel says a default whose option was removed or renamed is cleared on
 * save, so it is.
 */
function choiceSafe(field: FieldSettingsField, stored: string): string {
  if (field.type !== "select" && field.type !== "radio") return stored;
  if (stored === "") return stored;
  return (field.options ?? []).some(option => option.value === stored)
    ? stored
    : "";
}

/** The form values as the panel's field. */
export function valuesToPanelField(
  values: UserFieldFormValues
): FieldSettingsField {
  const field: FieldSettingsField = {
    id: USER_FIELD_PANEL_ID,
    name: values.name,
    label: values.label,
    type: values.type,
    validation: {
      required: values.required,
      minLength: boundOf(values.minLength),
      maxLength: boundOf(values.maxLength),
      min: boundOf(values.minValue),
      max: boundOf(values.maxValue),
    },
    admin: {
      description: values.description || undefined,
      placeholder: values.placeholder || undefined,
    },
    hasMany: values.hasMany,
  };
  if (values.options.length > 0) field.options = values.options;
  const defaultValue = panelDefault(values.type, values.defaultValue);
  if (defaultValue !== undefined) field.defaultValue = defaultValue;
  else if (values.defaultValue !== "") {
    (field as PanelField)[UNSHOWN_DEFAULT] = values.defaultValue;
  }
  return field;
}

/**
 * The form values the panel's field describes, with whether the field is
 * active carried over from `previous`.
 */
export function panelFieldToValues(
  field: FieldSettingsField,
  previous: UserFieldFormValues
): UserFieldFormValues {
  const validation = field.validation ?? {};
  return {
    label: field.label,
    name: field.name,
    type: field.type,
    required: validation.required === true,
    defaultValue: choiceSafe(field, storedDefault(field)),
    // The options editor's drag ids are its own; a user field stores label
    // and value alone.
    options: (field.options ?? []).map(({ label, value }) => ({
      label,
      value,
    })),
    hasMany: field.hasMany === true,
    minLength: boundText(validation.minLength),
    maxLength: boundText(validation.maxLength),
    minValue: boundText(validation.min),
    maxValue: boundText(validation.max),
    placeholder: field.admin?.placeholder ?? "",
    description: field.admin?.description ?? "",
    isActive: previous.isActive,
  };
}

/**
 * The panel's next field after an edit. Once the default control itself has
 * set or cleared a default, a stored default it could not show is no longer
 * the field's: kept, it would come back after the person cleared it.
 */
export function afterPanelEdit(
  previous: FieldSettingsField,
  next: FieldSettingsField
): FieldSettingsField {
  if (Object.is(previous.defaultValue, next.defaultValue)) return next;
  const edited: PanelField = { ...next };
  delete edited[UNSHOWN_DEFAULT];
  return edited;
}
