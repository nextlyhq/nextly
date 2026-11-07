/**
 * The collection a template draws, carried on the plugin's own writes of a
 * template's content.
 *
 * A template's lists and conditions are judged at save against the
 * collection it draws, read from the write itself
 * (`fields/list-query-judgement`). A write the plugin makes inside a
 * transaction cannot have the stored collection read for it there, and one
 * that names none is refused. So each of the plugin's writers that writes a
 * document's blocks inside a transaction hands its data through
 * {@link carryingTemplateTarget}, with the collection it read with the row.
 * The template guard holds that value to the stored one, so carrying it
 * changes nothing stored.
 *
 * @module templates/template-target
 */
import { TEMPLATES_SLUG } from "../collections/templates";

import { TEMPLATE_COLLECTION_FIELD } from "./template-preview-contract";

/** The collection a read row names, where it names one as text. */
export function templateTargetOf(row: unknown): string | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const value = (row as Record<string, unknown>)[TEMPLATE_COLLECTION_FIELD];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * `data` for a write to `collection`, with the template's collection carried
 * where `collection` is the templates collection (under the host's name for
 * it) and the write does not name one already; `data` unchanged otherwise.
 * `target` is the collection read with the row the write is planned from.
 */
export function carryingTemplateTarget(
  self: { readonly collections: Readonly<Record<string, string | undefined>> },
  collection: string,
  target: string | undefined,
  data: Record<string, unknown>
): Record<string, unknown> {
  const templates = self.collections[TEMPLATES_SLUG] ?? TEMPLATES_SLUG;
  if (
    collection !== templates ||
    target === undefined ||
    Object.hasOwn(data, TEMPLATE_COLLECTION_FIELD)
  ) {
    return data;
  }
  return { ...data, [TEMPLATE_COLLECTION_FIELD]: target };
}
