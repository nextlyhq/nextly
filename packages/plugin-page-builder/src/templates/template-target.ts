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
 * The template guard holds a template's collection to the stored one, and an
 * own design's `entryCollection` is never changed, so carrying either
 * changes nothing stored.
 *
 * @module templates/template-target
 */
import { TEMPLATES_SLUG } from "../collections/templates";

import { TEMPLATE_TARGET_FIELDS } from "./template-preview-contract";

/**
 * The collection a template draws, and the field it names it in: a
 * collection's template by `collection`, an entry's own design (whose
 * `collection` is empty) by `entryCollection`.
 */
export interface TemplateTarget {
  readonly field: string;
  readonly collection: string;
}

/** The collection a read row names as a template's, where it names one. */
export function templateTargetOf(row: unknown): TemplateTarget | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  for (const field of TEMPLATE_TARGET_FIELDS) {
    const value = (row as Record<string, unknown>)[field];
    if (typeof value === "string" && value !== "") {
      return { field, collection: value };
    }
  }
  return undefined;
}

/**
 * `data` for a write to `collection`, with the template's collection carried
 * in the field the row names it in, where `collection` is the templates
 * collection (under the host's name for it) and the write names none
 * already; `data` unchanged otherwise. `target` is what was read with the
 * row the write is planned from, so the value carried is the one stored.
 */
export function carryingTemplateTarget(
  self: { readonly collections: Readonly<Record<string, string | undefined>> },
  collection: string,
  target: TemplateTarget | undefined,
  data: Record<string, unknown>
): Record<string, unknown> {
  const templates = self.collections[TEMPLATES_SLUG] ?? TEMPLATES_SLUG;
  if (
    collection !== templates ||
    target === undefined ||
    TEMPLATE_TARGET_FIELDS.some(field => Object.hasOwn(data, field))
  ) {
    return data;
  }
  return { ...data, [target.field]: target.collection };
}
