/**
 * Which of an entity's settings differ between two sets of them, each named
 * in the words the Builder uses for it: the one answer the undo history's
 * announcements, the pending count and the review read, so they cannot
 * disagree about what changed.
 *
 * A switch is compared as it is drawn, unset reading as its default (cache
 * revalidation and webhook recording are on until turned off), and named as
 * the folded options name it, from the switches' own descriptions.
 *
 * @module lib/builder/settings-changes
 */
import {
  ADVANCED_SWITCHES,
  isSwitchOn,
} from "@admin/components/features/schema-builder/builder-settings-modal/advanced-switches";
import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";

/** One setting that differs, and how it is named. */
export interface SettingChange {
  key: keyof BuilderSettingsValues;
  label: string;
}

/** The settings typed rather than switched, in the order the settings show them. */
const TYPED_SETTINGS: ReadonlyArray<
  readonly [
    (
      | "singularName"
      | "pluralName"
      | "slug"
      | "description"
      | "icon"
      | "category"
    ),
    string,
  ]
> = [
  ["singularName", "name"],
  ["pluralName", "plural name"],
  ["slug", "address"],
  ["description", "description"],
  ["icon", "icon"],
  ["category", "category"],
];

/** Each setting that differs from `before` in `after`, in the order shown. */
export function settingChanges(
  before: BuilderSettingsValues,
  after: BuilderSettingsValues
): SettingChange[] {
  const changes: SettingChange[] = [];
  for (const [key, label] of TYPED_SETTINGS) {
    // Unset and empty are the same: a field left blank holds no value.
    if ((before[key] ?? "") !== (after[key] ?? "")) {
      changes.push({ key, label });
    }
  }
  for (const entry of ADVANCED_SWITCHES) {
    if (isSwitchOn(before, entry.key) !== isSwitchOn(after, entry.key)) {
      changes.push({ key: entry.key, label: entry.summary });
    }
  }
  if (before.versionsMaxPerDoc !== after.versionsMaxPerDoc) {
    changes.push({ key: "versionsMaxPerDoc", label: "versions kept" });
  }
  return changes;
}
