/**
 * A card's quick settings: what its widget lets a reader change on the card itself rather than
 * in the settings sheet.
 *
 * The header draws one: the first setting its widget marks `quick` that a header can hold, a
 * `select` drawn as a compact menu or a `checkbox` drawn as a toggle. The quick popover holds up
 * to three: the card's Collection, then the settings marked quick, each a choice it can draw. A
 * setting of any other type stays in the sheet, where every setting is drawn.
 *
 * @module components/features/widgets/edit/quick-setting
 */

import type {
  AnyWidgetSetting,
  ContentSetting,
  WidgetSetting,
} from "nextly/config";

/** A setting a card header can draw. */
export type QuickSetting = Extract<
  WidgetSetting,
  { type: "select" | "checkbox" }
>;

/** The widget's header quick setting, when it marks one the header can draw. */
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

/** A Collection setting: the collection a card reads. */
type CollectionSetting = Extract<ContentSetting, { type: "collection" }>;

/** A setting the quick popover can draw: a card's Collection, a choice, or an on/off. */
export type PopoverSetting = QuickSetting | CollectionSetting;

/** The most settings the quick popover holds; its Size comes after them. */
const MAX_POPOVER_SETTINGS = 3;

/**
 * The settings a card's quick popover holds, in its order: the widget's Collection, which the
 * popover offers whether or not it is marked (a collection picker takes no `quick`), then each
 * setting marked quick that it can draw, in the order declared, at most three in all. A
 * setting drawn by its own editor stays in the sheet, the one place that can draw it.
 */
export function popoverSettingsOf(
  settings: readonly AnyWidgetSetting[] | undefined
): PopoverSetting[] {
  const drawable = (setting: AnyWidgetSetting): setting is PopoverSetting =>
    setting.editor === undefined &&
    (setting.type === "collection" ||
      setting.type === "select" ||
      setting.type === "checkbox");
  const collection = settings?.find(
    (setting): setting is CollectionSetting =>
      drawable(setting) && setting.type === "collection"
  );
  const marked = (settings ?? []).filter(
    (setting): setting is PopoverSetting =>
      setting !== collection && setting.quick === true && drawable(setting)
  );
  return [...(collection ? [collection] : []), ...marked].slice(
    0,
    MAX_POPOVER_SETTINGS
  );
}
