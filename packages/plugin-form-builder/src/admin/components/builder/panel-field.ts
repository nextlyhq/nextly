/**
 * A form field as the shared settings panel edits it, and back.
 *
 * The panel edits the admin's field definition, which spells some of a form
 * field's settings differently (help text is `admin.description`, the custom
 * message `validation.message`, a dropdown's multiple choice `hasMany`) and
 * has no place for the rest (a text area's rows, a file's accepted types, a
 * field's show-or-hide logic). The settings it has a place for are moved
 * across; everything else travels unchanged under a key of this module's
 * own (a symbol, so no setting a plugin declares can be mistaken for it),
 * where the forms surface's own controls read and write it. A plugin field
 * type's declared settings are `pluginOptions`, on the form field as in the
 * panel. So a field the panel did not change comes back exactly as it went
 * in, and nothing a form stores is lost by being edited.
 *
 * @module admin/components/builder/panel-field
 */

import type { FieldSettingsField } from "@nextlyhq/plugin-sdk/admin";

import type { AnyFormField } from "../../../types";

type Bag = Record<string, unknown>;

/**
 * The form-only settings: the field's own properties the panel has no place
 * for, and the parts of its `validation` and `admin` that likewise have none.
 * `validation` and `admin` are present exactly when the form field had them,
 * so an empty object on the way in is an empty object on the way out.
 */
interface FormOnly extends Bag {
  validation?: Bag;
  admin?: Bag;
}

/**
 * Where the form-only settings travel on the panel's field. A symbol rather
 * than a named key: the panel copies a field by spreading it, which keeps a
 * symbol-keyed property, and no key a plugin declares can equal it.
 */
const FORM_ONLY: unique symbol = Symbol("form builder: form-only settings");

/** The panel's field, carrying the form-only settings. */
type PanelField = FieldSettingsField & { [FORM_ONLY]?: FormOnly };

type Width = NonNullable<FieldSettingsField["admin"]>["width"];
/** A default the panel's default editor can show and set. */
type PanelDefault = string | number | boolean;

/** The object with its undefined entries left out. */
function defined<T extends Bag>(bag: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(bag).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

/** A value only when it has entries, or when the original had the object. */
function present(bag: Bag, had: boolean): Bag | undefined {
  return had || Object.keys(bag).length > 0 ? bag : undefined;
}

function isPanelDefault(value: unknown): value is PanelDefault {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/**
 * The field as the panel edits it. `id` tells it apart from the fields beside
 * it while it is edited; forms store no id, so the host mints one per field.
 */
export function toPanelField(
  field: AnyFormField,
  id: string
): FieldSettingsField {
  const {
    type,
    name,
    label,
    placeholder,
    helpText,
    required,
    validation,
    admin,
    defaultValue,
    ...rest
  } = field;
  const { options, allowMultiple, pluginOptions, ...own } = rest as Bag & {
    options?: Array<{ label: string; value: string }>;
    allowMultiple?: boolean;
    pluginOptions?: Bag;
  };
  const {
    errorMessage,
    minLength,
    maxLength,
    min,
    max,
    pattern,
    ...validationRest
  } = (validation ?? {}) as Bag & {
    errorMessage?: string;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
  };
  const { width, ...adminRest } = (admin ?? {}) as Bag & { width?: Width };

  const formOnly: FormOnly = defined({
    ...own,
    validation: validation === undefined ? undefined : validationRest,
    admin: admin === undefined ? undefined : adminRest,
    // A default the panel cannot hold (a dropdown's several choices, a
    // plugin field's null) stays with the form's own settings rather than
    // being bent into one, or read as no default.
    defaultValue:
      defaultValue === undefined || isPanelDefault(defaultValue)
        ? undefined
        : defaultValue,
  });

  const panel: PanelField = {
    id,
    type,
    name,
    label,
    ...defined({
      options,
      hasMany: allowMultiple,
      defaultValue: isPanelDefault(defaultValue) ? defaultValue : undefined,
      // A plugin field type's declared settings, where the panel's controls
      // for them read and write.
      pluginOptions,
    }),
    admin: defined({ placeholder, description: helpText, width }),
    validation: defined({
      required,
      minLength,
      maxLength,
      min,
      max,
      pattern,
      message: errorMessage,
    }),
    [FORM_ONLY]: formOnly,
  };
  return panel;
}

/** The form-only settings a panel field carries. */
export function formOnlyOf(field: FieldSettingsField): FormOnly {
  return (field as PanelField)[FORM_ONLY] ?? {};
}

/** The form field the panel's field describes. */
export function fromPanelField(field: FieldSettingsField): AnyFormField {
  const {
    validation: validationRest,
    admin: adminRest,
    defaultValue: formDefault,
    ...own
  } = formOnlyOf(field);
  const panelAdmin = field.admin ?? {};
  const panelValidation = field.validation ?? {};

  const validation = present(
    {
      ...validationRest,
      ...defined({
        minLength: panelValidation.minLength,
        maxLength: panelValidation.maxLength,
        min: panelValidation.min,
        max: panelValidation.max,
        pattern: panelValidation.pattern,
        errorMessage: panelValidation.message,
      }),
    },
    validationRest !== undefined
  );
  const admin = present(
    { ...adminRest, ...defined({ width: panelAdmin.width }) },
    adminRest !== undefined
  );

  return {
    ...own,
    type: field.type,
    name: field.name,
    label: field.label,
    ...defined({
      placeholder: panelAdmin.placeholder,
      helpText: panelAdmin.description,
      required: panelValidation.required,
      options: field.options?.map(({ label, value }) => ({ label, value })),
      allowMultiple: field.hasMany,
      defaultValue: formDefaultValue(field, formDefault),
      validation,
      admin,
      pluginOptions: field.pluginOptions,
    }),
  };
}

/**
 * The default the form stores. The panel's default editor picks one value, so
 * where a dropdown takes several, the value it picks becomes a list of one:
 * the form checks a several-choice answer, its default included, as a list.
 * A list the panel could not show is kept until the panel sets another.
 */
function formDefaultValue(
  field: FieldSettingsField,
  formDefault: unknown
): unknown {
  const picked = dateOnly(field);
  if (picked === undefined || picked === null) {
    // A list kept for a dropdown that now takes one choice: its one value, or
    // none, since the form checks a one-choice answer as a single value.
    if (
      field.type === "select" &&
      field.hasMany !== true &&
      Array.isArray(formDefault)
    ) {
      return formDefault.length === 1 ? formDefault[0] : undefined;
    }
    return formDefault;
  }
  return field.hasMany === true && typeof picked === "string"
    ? [picked]
    : picked;
}

/**
 * The panel's default, with a date's in the form's own shape. The panel's
 * date editor stores the chosen day as that day's UTC midnight
 * (`2026-01-01T00:00:00.000Z`); a form's date is the day alone, as its date
 * input shows it and a visitor's answer arrives, so the day is kept.
 */
function dateOnly(
  field: FieldSettingsField
): FieldSettingsField["defaultValue"] {
  const value = field.defaultValue;
  return field.type === "date" &&
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value)
    ? value.slice(0, 10)
    : value;
}

/**
 * The panel field with some of its form-only settings changed: how the forms
 * surface's own controls write what the panel has no place for.
 */
export function withFormOnly(
  field: FieldSettingsField,
  changes: Partial<AnyFormField>
): FieldSettingsField {
  return toPanelField({ ...fromPanelField(field), ...changes }, field.id);
}
