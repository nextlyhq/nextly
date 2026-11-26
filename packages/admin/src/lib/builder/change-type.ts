/**
 * A field's type changed: what the field keeps, and, before it is saved, which types it may become.
 *
 * A type keeps the settings the settings panel shows for it (`settingsFittingType`), read from the
 * panel's own rules: its own settings (a list of options), its placeholder, and the validation
 * rules it offers. A value set for one type never survives, unseen, into one that cannot show or
 * use it. The user fields' form asks the same question of its own values, so the two surfaces keep
 * the same settings across the same change.
 *
 * @module lib/builder/change-type
 */
import {
  OPTIONS_PICKER_SETTINGS,
  optionsPickerOf,
} from "@admin/components/features/schema-builder/option-settings";
import type {
  BuilderField,
  BuilderFieldAdmin,
  BuilderFieldValidation,
} from "@admin/components/features/schema-builder/types";
import { surfaceTypeSettings } from "@admin/components/field-ui/settings-panel/core-type-settings";
import { hasPlaceholder } from "@admin/components/field-ui/settings-panel/placeholder-types";
import type { FieldSettingsSurface } from "@admin/components/field-ui/settings-panel/types";
import { validationRulesShown } from "@admin/components/field-ui/settings-panel/validation-rules-shown";
import type { PluginMetadata } from "@admin/types/branding";

import { CONTAINER_TYPES } from "./template-check";

/** Which of a field's settings a type shows, and so keeps when a field becomes it. */
export interface SettingsThatFit {
  /** A list of options to pick from. */
  options: boolean;
  /** More than one option picked: a dropdown's, in every surface's options editor. */
  hasMany: boolean;
  /** Its input's placeholder (`hasPlaceholder`). */
  placeholder: boolean;
  /** The validation rules it offers, by the names a field stores them under. */
  validation: ReadonlySet<string>;
}

/** Where a type's settings are shown: the panel's surface, and the installed plugins. */
export interface SettingsPlace {
  surface: Pick<
    FieldSettingsSurface,
    "surface" | "typeSettings" | "validationRules"
  >;
  plugins: readonly PluginMetadata[] | undefined;
}

/**
 * The settings `type` shows at `place`. A type has options where its own settings are a dropdown's
 * (`surfaceTypeSettings`): the surface's own table decides, so a user field's yes/no checkbox has
 * none where the entry form's set of choices has them.
 */
export function settingsFittingType(
  type: string,
  place: SettingsPlace
): SettingsThatFit {
  const own = surfaceTypeSettings(place.surface, type);
  const options =
    own !== undefined && own === surfaceTypeSettings(place.surface, "select");
  return {
    options,
    hasMany: options && OPTIONS_PICKER_SETTINGS[optionsPickerOf(type)].hasMany,
    placeholder: hasPlaceholder(place.surface.surface, type),
    validation: new Set(
      validationRulesShown({
        surface: place.surface.surface,
        type,
        plugins: place.plugins,
        narrow: place.surface.validationRules,
      })
    ),
  };
}

/** The admin options every type has: where the field sits, whether it shows, and when. */
const SHARED_ADMIN = [
  "width",
  "position",
  "readOnly",
  "hidden",
  "condition",
  "description",
] as const satisfies readonly (keyof BuilderFieldAdmin)[];

/**
 * The admin options `type` keeps: those every type has, its input's placeholder, and what the
 * Builder's options editor shows beside a list of options for its picker (`OPTIONS_PICKER_SETTINGS`):
 * a dropdown's placeholder and Clearable, radio buttons' layout.
 */
function keptAdmin(
  admin: BuilderFieldAdmin | undefined,
  type: string,
  fits: SettingsThatFit
): BuilderFieldAdmin | undefined {
  if (admin === undefined) return undefined;
  const picker = fits.options
    ? OPTIONS_PICKER_SETTINGS[optionsPickerOf(type)]
    : undefined;
  const kept = sharedAdminOf(admin);
  if (
    (fits.placeholder || picker?.placeholder === true) &&
    admin.placeholder !== undefined
  ) {
    kept.placeholder = admin.placeholder;
  }
  if (picker?.clearable === true && admin.isClearable !== undefined) {
    kept.isClearable = admin.isClearable;
  }
  if (picker?.layout === true && admin.layout !== undefined) {
    kept.layout = admin.layout;
  }
  return kept;
}

function keptValidation(
  validation: BuilderFieldValidation | undefined,
  fits: SettingsThatFit
): BuilderFieldValidation {
  return Object.fromEntries(
    Object.entries(validation ?? {}).filter(([rule]) =>
      fits.validation.has(rule)
    )
  );
}

/**
 * `field` as a field of `type`, keeping what fits it: its id, name and label, where it came from
 * (`source`), help text, the admin
 * options every type has (width, placement, visibility, its condition), its database settings
 * (Unique, Index, Localized), and of the rest only what `fits` says the new type shows. A default
 * is not kept, since one written for the old type need not be a value of the new one. A group
 * becoming repeating rows, or the reverse, keeps the fields it holds.
 *
 * Localized is kept as it is set. A field it was never set on is translated or not by its type's own
 * default (`fieldLocalized`), so such a field's switch reads the new type's default after the change. A
 * group or repeating rows have none of their own to keep (`advancedOf`).
 */
export function withTypeChanged(
  field: BuilderField,
  type: string,
  fits: SettingsThatFit
): BuilderField {
  const admin = keptAdmin(field.admin, type, fits);
  return {
    id: field.id,
    name: field.name,
    label: field.label,
    type,
    validation: keptValidation(field.validation, fits),
    ...(field.source !== undefined ? { source: field.source } : {}),
    ...(field.description !== undefined
      ? { description: field.description }
      : {}),
    ...(admin !== undefined ? { admin } : {}),
    ...advancedOf(type, field.advanced),
    ...(fits.options && field.options !== undefined
      ? { options: field.options }
      : {}),
    ...(fits.hasMany && field.hasMany !== undefined
      ? { hasMany: field.hasMany }
      : {}),
    ...(CONTAINER_TYPES.has(type) &&
    CONTAINER_TYPES.has(field.type) &&
    field.fields
      ? { fields: field.fields }
      : {}),
  };
}

/**
 * The database settings a field of `type` keeps of `advanced`. A group or repeating rows keep one
 * structure in every language, and the fields inside choose what is translated: marked Localized
 * themselves, a configuration is refused, so none is carried onto one. One back to its type as saved has
 * what it was saved with (`saved`).
 */
function advancedOf(
  type: string,
  advanced: BuilderField["advanced"],
  saved?: BuilderField["advanced"]
): Pick<BuilderField, "advanced"> {
  if (advanced === undefined) return {};
  if (!CONTAINER_TYPES.has(type)) return { advanced };
  const { localized: _carried, ...rest } = advanced;
  return {
    advanced:
      saved?.localized === undefined
        ? rest
        : { ...rest, localized: saved.localized },
  };
}

/** The admin options every type has that the person has given `field`, on their own. */
function sharedAdminOf(
  admin: BuilderFieldAdmin | undefined
): BuilderFieldAdmin {
  const shared: BuilderFieldAdmin = {};
  for (const key of SHARED_ADMIN) {
    if (admin?.[key] !== undefined)
      Object.assign(shared, { [key]: admin[key] });
  }
  return shared;
}

/**
 * `current` made the type it was saved as: the saved field's type and every setting of its own
 * (options, links, the bounds its values are held to), with what every type has as the person has
 * it now: its name, label, help text, where and when it shows, and Required.
 */
export function withSavedTypeRestored(
  current: BuilderField,
  saved: BuilderField
): BuilderField {
  const {
    description: _description,
    admin: savedAdmin,
    validation: savedValidation,
    ...ownSettings
  } = saved;
  const { required: _required, ...savedRules } = savedValidation ?? {};
  // The saved field's admin settings of its own type (a placeholder, a picker's layout) come back;
  // the shared ones are as the person has them now.
  const ownAdmin = Object.fromEntries(
    Object.entries(savedAdmin ?? {}).filter(
      ([key]) => !(SHARED_ADMIN as readonly string[]).includes(key)
    )
  );
  const admin = { ...ownAdmin, ...sharedAdminOf(current.admin) };
  return {
    ...ownSettings,
    id: current.id,
    name: current.name,
    label: current.label,
    validation: {
      ...savedRules,
      ...(current.validation?.required !== undefined
        ? { required: current.validation.required }
        : {}),
    },
    ...(current.description !== undefined
      ? { description: current.description }
      : {}),
    ...(Object.keys(admin).length > 0 ? { admin } : {}),
    ...advancedOf(saved.type, current.advanced, saved.advanced),
    ...(current.fields !== undefined ? { fields: current.fields } : {}),
  };
}

/** How many fields a field holds, at any depth. */
function fieldsInside(field: BuilderField): number {
  return (field.fields ?? []).reduce(
    (count, inner) => count + 1 + fieldsInside(inner),
    0
  );
}

/**
 * Why a field holding fields may not become `type`, or null where it may: a group or repeating rows
 * holding fields becomes only the other, which keeps them; any other type would leave them nowhere.
 */
export function containerChangeRefused(
  field: BuilderField,
  type: string
): { holds: number } | null {
  const holds = fieldsInside(field);
  if (holds === 0 || !CONTAINER_TYPES.has(field.type)) return null;
  return CONTAINER_TYPES.has(type) ? null : { holds };
}

/**
 * Whether Change type… is offered for a field, in its settings and on its row alike: one that can
 * be changed here, and not one of the entity's built-in fields, whose types are the system's.
 */
export function changeTypeOffered(
  field: BuilderField,
  readOnly: boolean
): boolean {
  return !readOnly && field.isSystem !== true;
}
