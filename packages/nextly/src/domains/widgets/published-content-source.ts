/**
 * A collection as a reader's content settings see it: its own module, holding a type alone, so
 * the knobs that read it and the admin that type-checks them pull in nothing of the server's
 * dashboard read beside it.
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
