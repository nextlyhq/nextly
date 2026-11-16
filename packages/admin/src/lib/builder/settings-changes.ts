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
  type AdvancedSwitchKey,
  isSwitchOn,
} from "@admin/components/features/schema-builder/builder-settings-modal/advanced-switches";
import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";

/** One setting that differs, how it is named, and what it was and is. */
export interface SettingChange {
  key: keyof BuilderSettingsValues;
  label: string;
  from: string;
  to: string;
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

// Every setting is compared, or set aside here by name: a key added to the
// settings with neither fails to compile, rather than being saved uncounted
// and unreviewed. The starting field is chosen once, at create, and is no
// setting after it.
type ComparedKey =
  | (typeof TYPED_SETTINGS)[number][0]
  | AdvancedSwitchKey
  | "versionsMaxPerDoc"
  | "startingFieldType";
type UncomparedKey = Exclude<keyof BuilderSettingsValues, ComparedKey>;
const _everySettingIsCompared: [UncomparedKey] extends [never] ? true : never =
  true;
void _everySettingIsCompared;

/** How many versions are kept, in words: unset is the server's default. */
function keptWords(kept: number | false | undefined): string {
  if (kept === undefined) return "the default";
  return kept === false ? "no limit" : String(kept);
}

/** Each setting that differs from `before` in `after`, in the order shown. */
export function settingChanges(
  before: BuilderSettingsValues,
  after: BuilderSettingsValues
): SettingChange[] {
  const changes: SettingChange[] = [];
  for (const [key, label] of TYPED_SETTINGS) {
    // Unset and empty are the same: a field left blank holds no value.
    const from = before[key] ?? "";
    const to = after[key] ?? "";
    if (from !== to) changes.push({ key, label, from, to });
  }
  for (const entry of ADVANCED_SWITCHES) {
    const was = isSwitchOn(before, entry.key);
    const is = isSwitchOn(after, entry.key);
    if (was !== is) {
      changes.push({
        key: entry.key,
        label: entry.summary,
        from: was ? "on" : "off",
        to: is ? "on" : "off",
      });
    }
  }
  if (before.versionsMaxPerDoc !== after.versionsMaxPerDoc) {
    changes.push({
      key: "versionsMaxPerDoc",
      label: "versions kept",
      from: keptWords(before.versionsMaxPerDoc),
      to: keptWords(after.versionsMaxPerDoc),
    });
  }
  return changes;
}
