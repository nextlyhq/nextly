/**
 * A card's quick settings: what its widget lets a reader change on the card itself rather than
 * in the settings sheet.
 *
 * The header draws one: the first setting its widget marks `quick` that a header can hold, a
 * `select` drawn as a compact menu or a `checkbox` drawn as a toggle. The quick popover holds the
 * card's Collection, then the settings marked quick, each a choice it can draw. A setting of any
 * other type stays in the sheet, where every setting is drawn.
 *
 * @module components/features/widgets/edit/quick-setting
 */

import {
  MAX_QUICK_SETTINGS,
  type AnyWidgetSetting,
  type ContentSetting,
  type WidgetSetting,
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
  // The first marked one the header CAN draw: a widget may mark up to three, and one of another
  // type, marked first, is drawn in the popover or the sheet rather than taking the header's place.
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

/** A Collection setting: the collection a card reads. */
type CollectionSetting = Extract<ContentSetting, { type: "collection" }>;

/** A setting the quick popover can draw: a card's Collection, a choice, or an on/off. */
export type PopoverSetting = QuickSetting | CollectionSetting;

/**
 * The settings a card's quick popover holds, in its order: the widget's Collection, which the
 * popover offers whether or not it is marked (a collection picker takes no `quick`), then each
 * setting marked quick that it can draw, in the order declared, as many as core lets a widget
 * mark (`MAX_QUICK_SETTINGS`). The Collection is the card's subject rather than one of those, so
 * it takes none of their places. A setting drawn by its own editor stays in the sheet, the one
 * place that can draw it.
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
  const marked = (settings ?? [])
    .filter(
      (setting): setting is PopoverSetting =>
        setting !== collection && setting.quick === true && drawable(setting)
    )
    .slice(0, MAX_QUICK_SETTINGS);
  return [...(collection ? [collection] : []), ...marked];
}
