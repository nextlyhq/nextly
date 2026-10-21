/**
 * A card's quick setting: the one setting its widget marks `quick`, changed on the card itself
 * rather than in the settings sheet.
 *
 * Only a choice can sit on a card header: a `select`, drawn as a compact menu, or a `checkbox`,
 * drawn as a toggle. A widget marking any other type quick keeps it in the sheet, where every
 * setting is drawn.
 *
 * @module components/features/widgets/edit/quick-setting
 */

import type { AnyWidgetSetting, WidgetSetting } from "nextly/config";

/** A setting a card header can draw. */
export type QuickSetting = Extract<
  WidgetSetting,
  { type: "select" | "checkbox" }
>;

/** The widget's quick setting, when it marks one the header can draw. */
export function quickSettingOf(
  settings: readonly AnyWidgetSetting[] | undefined
): QuickSetting | undefined {
  const marked = settings?.find(setting => setting.quick === true);
  if (marked?.type === "select" || marked?.type === "checkbox") {
    return marked;
  }
  return undefined;
}

/** What the reader is told a quick setting's value now is: its option's label, or On / Off. */
export function quickValueLabel(setting: QuickSetting, value: unknown): string {
  if (setting.type === "checkbox") return value === true ? "On" : "Off";
  return (
    setting.options.find(option => option.value === value)?.label ??
    String(value)
  );
}
