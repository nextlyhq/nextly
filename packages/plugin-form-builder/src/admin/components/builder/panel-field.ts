/**
 * A form field as the shared settings panel edits it, and back.
 *
 * The panel edits the admin's field definition, which spells some of a form
 * field's settings differently (help text is `admin.description`, the custom
 * message `validation.message`, a dropdown's multiple choice `hasMany`) and
 * has no place for the rest (a text area's rows, a file's accepted types, a
 * field's show-or-hide logic). The settings it has a place for are moved
 * across; everything else travels unchanged in `pluginOptions`, where the
 * forms surface's own controls read and write it. So a field the panel did
 * not change comes back exactly as it went in, and nothing a form stores is
 * lost by being edited.
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

/** Where the form-only settings travel inside the panel's field. */
const FORM_ONLY = "form";

type Width = NonNullable<FieldSettingsField["admin"]>["width"];
type Scalar = string | number | boolean | null;

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

function isScalar(value: unknown): value is Scalar {
  return (
    value === null ||
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
  const { options, allowMultiple, ...own } = rest as Bag & {
    options?: Array<{ label: string; value: string }>;
    allowMultiple?: boolean;
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
    // A default the panel cannot hold (a dropdown's several choices) stays
    // with the form's own settings rather than being bent into one.
    defaultValue:
      defaultValue === undefined || isScalar(defaultValue)
        ? undefined
        : defaultValue,
  });

  return {
    id,
    type,
    name,
    label,
    ...defined({
      options,
      hasMany: allowMultiple,
      defaultValue: isScalar(defaultValue) ? defaultValue : undefined,
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
    pluginOptions: { [FORM_ONLY]: formOnly },
  };
}

/** The form-only settings a panel field carries. */
export function formOnlyOf(field: FieldSettingsField): FormOnly {
  const bag = field.pluginOptions?.[FORM_ONLY];
  return bag !== null && typeof bag === "object" ? (bag as FormOnly) : {};
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
      defaultValue: field.defaultValue ?? formDefault,
      validation,
      admin,
    }),
  };
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
