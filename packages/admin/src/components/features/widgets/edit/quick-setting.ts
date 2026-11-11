/**
 * A card's quick setting: what its widget lets a reader change on the card itself, as well as
 * in its settings drawer.
 *
 * The header draws one: the first setting its widget marks `quick` that a header can hold, a
 * `select` drawn as a compact menu (or, with exactly two options, as a segmented control
 * showing both) or a `checkbox` drawn as a toggle. A setting of any other type is changed in
 * the drawer alone, where every setting is drawn.
 *
 * @module components/features/widgets/edit/quick-setting
 */

import type { AnyWidgetSetting, WidgetSetting } from "nextly/config";

/** A setting a card header can draw. */
export type QuickSetting = Extract<
  WidgetSetting,
  { type: "select" | "checkbox" }
>;

/** The widget's header quick setting, when it marks one the header can draw. */
export function quickSettingOf(
  settings: readonly AnyWidgetSetting[] | undefined
): QuickSetting | undefined {
  // The first marked one the header CAN draw: a widget may mark up to three, and one of another
  // type, marked first, is drawn in the drawer alone rather than taking the header's place.
  return settings?.find(
    (setting): setting is QuickSetting =>
      setting.quick === true &&
      (setting.type === "select" || setting.type === "checkbox")
  );
}

/** What the reader is told a quick setting's value now is: its option's label, or On / Off. */
export function quickValueLabel(setting: QuickSetting, value: unknown): string {
  if (setting.type === "checkbox") return value === true ? "On" : "Off";
  return (
    setting.options.find(option => option.value === value)?.label ??
    String(value)
  );
}
