/**
 * entry-locale-source — how a document answers "read another language of me",
 * and which of its fields that answer covers.
 *
 * Copy-from-language needs two facts about the document being edited: the set
 * of translatable field names, and a way to read one other language's values.
 * Entries and singles both have those facts but hold them differently — an
 * entry is addressed by collection slug and id, a single by its slug alone.
 *
 * Putting the READ behind a function lets one copy-from implementation serve
 * both. It also puts the `fallbackLocale: "none"` invariant in one place: with
 * fallback left on, an untranslated source field comes back filled with the
 * default language's text, and copy-from would write that in as though it were
 * a translation. Stated twice in two forms, that is a rule one of them can
 * quietly drop.
 *
 * @module components/features/entries/entry-locale-source
 */

import { resolveLocalizedFieldNames } from "nextly/config";

import { entryApi } from "@admin/services/entryApi";
import { singleApi } from "@admin/services/singleApi";

import type { EntryLocaleContextValue } from "./EntryLocaleContext";

/** Reads one language's raw values for the document being edited. */
export type FetchSourceValues = NonNullable<
  EntryLocaleContextValue["fetchSourceValues"]
>;

/**
 * The field shape this module needs. Deliberately structural and fully
 * optional: entries carry `FieldDefinition` and singles carry `FieldConfig`,
 * and neither should have to be converted to be classified.
 */
interface ClassifiableFieldLike {
  type?: string;
  name?: string;
  localized?: boolean;
}

/**
 * Read options every source read shares.
 *
 * `fallbackLocale: "none"` — copy what the source language ACTUALLY holds. See
 * the module note: with fallback on, this silently copies the default language.
 * `depth: 0` — only this document's own values are copied, so there is no
 * reason to resolve its relations.
 */
const SOURCE_READ = { fallbackLocale: "none", depth: 0 } as const;

/** The translatable field names of a document, given its master localization switch. */
export function localizedFieldNamesOf(
  fields: readonly ClassifiableFieldLike[],
  documentLocalized: boolean
): string[] {
  return resolveLocalizedFieldNames(
    fields.map(f => ({
      type: f.type ?? "",
      name: f.name ?? "",
      localized: f.localized,
    })),
    documentLocalized
  );
}

/**
 * A collection entry's source reader.
 *
 * Undefined without an id — in create mode the entry has no other language to
 * be read from, and an absent reader is how copy-from declines to offer itself.
 */
export function collectionSourceFetcher(
  collectionSlug: string,
  entryId: string | undefined
): FetchSourceValues | undefined {
  if (!entryId) return undefined;
  return sourceLocale =>
    entryApi.findByID(collectionSlug, entryId, {
      locale: sourceLocale,
      ...SOURCE_READ,
    });
}

/**
 * A single's source reader.
 *
 * Unconditional, unlike a collection entry's: a single always exists once its
 * schema does, so it has no pre-creation state to guard against.
 */
export function singleSourceFetcher(slug: string): FetchSourceValues {
  return sourceLocale =>
    singleApi.getDocument(slug, {
      locale: sourceLocale,
      ...SOURCE_READ,
    });
}
