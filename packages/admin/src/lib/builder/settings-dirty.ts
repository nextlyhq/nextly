// Why: the builder pages enable Save by diffing the settings modal's values
// against the ones loaded from the server. Each page used to spell that diff
// out field by field, so a newly added setting reached the API but left Save
// greyed out until someone remembered to extend both comparisons — a failure
// that looks like nothing happening at all. Comparing from one exhaustive key
// list makes a forgotten setting a compile error instead.

import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";

/** Every settings key the dirty check compares. */
const COMPARED_KEYS = [
  "singularName",
  "pluralName",
  "slug",
  "description",
  "icon",
  "category",
  "status",
  "i18n",
  "versions",
] as const;

type ComparedKey = (typeof COMPARED_KEYS)[number];

// A new key on BuilderSettingsValues must be added to COMPARED_KEYS or this
// assignment stops compiling: the unlisted key survives the Exclude, and a
// non-never type is not assignable to the `true` branch's `never`.
type UncomparedKey = Exclude<keyof BuilderSettingsValues, ComparedKey>;
const _everySettingIsCompared: [UncomparedKey] extends [never] ? true : never =
  true;
void _everySettingIsCompared;

/**
 * Whether the settings modal's values differ from the ones last loaded.
 *
 * Values are scalars, so identity comparison is the whole check. A missing
 * baseline means nothing has loaded yet, which is not an edit.
 */
export function settingsAreDirty(
  original: BuilderSettingsValues | null,
  current: BuilderSettingsValues | null
): boolean {
  if (!original || !current) return false;
  return COMPARED_KEYS.some(key => original[key] !== current[key]);
}
