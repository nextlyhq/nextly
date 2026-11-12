/**
 * How a core card's settings follow one another in its settings drawer: which of them say
 * nothing as the drawer holds the others now, and which of a choice's options cannot be chosen
 * with them. A Count set to Users has no entries to choose among, so its Count and Filter are
 * not drawn; a status split only splits every entry of a collection with a lifecycle, so it
 * cannot be chosen beside Drafts.
 *
 * Read by the drawer for the card it edits, from the values its form holds now, so a change of
 * one setting is followed at once by the others. The card's own `load` holds every stored value
 * to the same rules, so a value stored before is read as it would now be chosen.
 *
 * @module components/features/widgets/edit/setting-rules
 */

import type { PublishedContentSource } from "nextly/config";

import { countSettingRule } from "../../dashboard/count-settings";

/** What one setting of a card's drawer does beside the others, as they are held now. */
export interface SettingRule {
  /** Not drawn: it says nothing about what the card shows with the others as they are. */
  hidden?: boolean;
  /** The values offered but not choosable now, drawn struck through. */
  disabled?: readonly string[];
  /** What the setting takes when the value it holds is one it cannot take now. */
  fallback?: string;
  /** Said under the setting, after its own help, while some of its options cannot be chosen. */
  hint?: string;
}

/** A card's rules: for each setting, by name, what it does beside the others. */
export type SettingRules = (
  name: string,
  values: Readonly<Record<string, unknown>>,
  sources: readonly PublishedContentSource[]
) => SettingRule | undefined;

/** Each core card with rules, by its widget id. */
const CORE_SETTING_RULES: Readonly<Record<string, SettingRules>> = {
  "core/count": countSettingRule,
};

/** The rules of the card a drawer edits, where it has any. */
export function settingRulesOf(
  widgetId: string | undefined
): SettingRules | undefined {
  return widgetId === undefined ? undefined : CORE_SETTING_RULES[widgetId];
}
