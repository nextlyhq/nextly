/**
 * A collection as a reader's content settings see it, and the one rule for which of its fields a
 * setting may name: its own module, importing types alone, so the knobs that read it, the admin
 * and a card's server-side settings pull in nothing of the server's dashboard read beside it.
 *
 * @module domains/widgets/published-content-source
 */

import type { WidgetSourceField } from "./sources";

/**
 * A collection a card's content settings may name, with the fields they may
 * offer to filter, sort or group by.
 *
 * @experimental The shape may still change while the settings sheet's
 * content controls are built on it.
 */
export interface PublishedContentSource {
  collection: string;
  label: string;
  /**
   * Whether the collection has a draft and published lifecycle: the source's
   * own `lifecycleStatus`, so a card asks a status split only of a collection
   * that has one. @experimental
   */
  lifecycle: boolean;
  /**
   * The field that names an entry, as the source resolves it (the author's
   * `admin.useAsTitle`, or the shared rule): what a list of the collection's
   * entries asks for each row. Absent when the source has none, or when the
   * field is not offered to this reader. @experimental
   */
  titleField?: string;
  fields: Pick<
    WidgetSourceField,
    "name" | "label" | "type" | "choices" | "groupable" | "presentable"
  >[];
}

/** One field of a published collection. */
type PublishedField = PublishedContentSource["fields"][number];

/**
 * Whether `field` may be what a setting of `settingType` names: offered at
 * all, which a published field is; for Group by, one the read will group by;
 * and for Fields, one a row can print that is not the collection's title,
 * which every row already leads with.
 *
 * The rule the settings sheet offers fields by and the server judges a
 * stored value by, so the two cannot disagree about which fields fit.
 *
 * @experimental While the settings sheet's content controls are built on it.
 */
export function contentFieldFits(
  settingType: string,
  field: PublishedField,
  titleField?: string
): boolean {
  if (settingType === "groupBy") return field.groupable !== false;
  if (settingType === "fields") {
    return field.presentable !== false && field.name !== titleField;
  }
  return true;
}

/**
 * The first of `names` that `source` does not offer a setting of
 * `settingType` ({@link contentFieldFits}), or `undefined` when every one
 * fits. A field the collection no longer has, or one its reader may not read,
 * is not among its published fields, so it never fits.
 *
 * @experimental While the settings sheet's content controls are built on it.
 */
export function unfitContentField(
  settingType: string,
  names: readonly string[],
  source: PublishedContentSource
): string | undefined {
  return names.find(name => {
    const field = source.fields.find(candidate => candidate.name === name);
    return (
      field === undefined ||
      !contentFieldFits(settingType, field, source.titleField)
    );
  });
}
