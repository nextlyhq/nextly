/**
 * The on/off options of an entity's settings, described once: the Advanced
 * tab draws each switch from its entry, and the new-entity dialog's folded
 * options name the ones that are on from the same entry, so the two cannot
 * disagree on what an option is called or whether it is on.
 *
 * @module components/features/schema-builder/builder-settings-modal/advanced-switches
 */
import type { BuilderSettingsValues } from "../BuilderSettingsModal";
import type { AdvancedField } from "../builder-config";

/** The settings an on/off switch holds. */
export type AdvancedSwitchKey = AdvancedField &
  ("status" | "i18n" | "versions" | "revalidate" | "webhooks");

export interface AdvancedSwitch {
  key: AdvancedSwitchKey;
  /** The switch's accessible name. */
  ariaLabel: string;
  /** The heading drawn beside the switch. */
  label: string;
  /** How the folded options name it while it is on. */
  summary: string;
  /**
   * Whether it is on while the setting holds no value: cache revalidation and
   * webhook recording are on until turned off.
   */
  onWhenUnset: boolean;
}

/** In the order the Advanced tab draws them. */
export const ADVANCED_SWITCHES: readonly AdvancedSwitch[] = [
  {
    key: "status",
    ariaLabel: "Status",
    label: "Status (Draft / Published)",
    summary: "drafts and publishing",
    onWhenUnset: false,
  },
  {
    key: "i18n",
    ariaLabel: "Internationalization",
    label: "Internationalization",
    summary: "translation",
    onWhenUnset: false,
  },
  {
    key: "versions",
    ariaLabel: "Version history",
    label: "Version history",
    summary: "version history",
    onWhenUnset: false,
  },
  {
    key: "revalidate",
    ariaLabel: "Cache revalidation",
    label: "Cache revalidation",
    summary: "cache revalidation",
    onWhenUnset: true,
  },
  {
    key: "webhooks",
    ariaLabel: "Webhook recording",
    label: "Webhook recording",
    summary: "webhook recording",
    onWhenUnset: true,
  },
];

/** The entry for `key`. */
export function advancedSwitch(key: AdvancedSwitchKey): AdvancedSwitch {
  const entry = ADVANCED_SWITCHES.find(item => item.key === key);
  // Every key of the type has an entry; the guard keeps a missing one loud.
  if (!entry) throw new Error(`no switch is described for ${key}`);
  return entry;
}

/** Whether the switch for `key` is on for `values`. */
export function isSwitchOn(
  values: BuilderSettingsValues,
  key: AdvancedSwitchKey
): boolean {
  return values[key] ?? advancedSwitch(key).onWhenUnset;
}
