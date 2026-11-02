/**
 * Where the Page Builder opens for one field: the document view the plugin
 * contributes on its field type, at the document's own address, naming the
 * field so a document with several opens the one the author chose.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/builder-address
 */
import type {
  DocumentIdentity,
  DocumentLocale,
} from "@nextlyhq/plugin-sdk/admin";

import { BUILDER_VIEW_PATH } from "../../builder-view";

/**
 * The builder's address, with what to say about where it leads, or why this
 * field has none.
 */
export type BuilderAddress =
  | { href: string; note?: string }
  | { unavailable: string };

/**
 * Said beside the way in while another language is on screen. The builder
 * edits the default language only, so the link opens that one whatever the
 * edit screen shows, and the card's preview is showing the other language.
 */
const DEFAULT_LANGUAGE_NOTE =
  "Opens the default language, the one the Page Builder edits.";

/**
 * Whether the edit screen shows a language other than the default, the one the
 * Page Builder edits.
 *
 * One answer for the two things that follow from it: the way in says where it
 * leads, and the entry screen offers no way into a single section, since that
 * language's document is not the one the builder opens and its sections need
 * not be the same.
 */
export function showsAnotherLanguage(
  locale?: Pick<DocumentLocale, "documentLocalized" | "isDefaultLocale"> | null
): boolean {
  return locale?.documentLocalized === true && !locale.isDefaultLocale;
}

/**
 * The builder's address for `fieldName` on the document the form holds.
 *
 * Withheld, with the sentence the card shows, where there is no address to
 * open: outside a document, on an entry that has never been saved, and for a
 * field inside a group or a repeater, which the view does not reach.
 */
export function builderAddress(
  identity: DocumentIdentity | null,
  fieldName: string,
  locale?: Pick<DocumentLocale, "documentLocalized" | "isDefaultLocale"> | null
): BuilderAddress {
  const elsewhere = showsAnotherLanguage(locale)
    ? { note: DEFAULT_LANGUAGE_NOTE }
    : {};
  if (identity === null) {
    return { unavailable: "The Page Builder opens from a saved page." };
  }
  if (fieldName.includes(".")) {
    return {
      unavailable:
        "The Page Builder opens for a top-level field only. Move this field to the top level to edit it visually.",
    };
  }
  const query = `?field=${encodeURIComponent(fieldName)}`;
  const slug = encodeURIComponent(identity.slug);
  if (identity.kind === "single") {
    return {
      href: `/admin/singles/${slug}/${BUILDER_VIEW_PATH}${query}`,
      ...elsewhere,
    };
  }
  if (identity.documentId === undefined) {
    return { unavailable: "Save this page to open the Page Builder." };
  }
  const id = encodeURIComponent(identity.documentId);
  return {
    href: `/admin/collections/${slug}/${id}/${BUILDER_VIEW_PATH}${query}`,
    ...elsewhere,
  };
}

/**
 * The query key naming the section the builder opens at.
 *
 * The admin keeps the same key in its list of a view's own address keys, so
 * moving between the edit form and the builder at a section stays on the one
 * document rather than counting as leaving it.
 */
const SECTION_PARAM = "section";

/**
 * The builder's address `href`, opened at the section `sectionId`.
 *
 * Built on the address `builderAddress` gave rather than beside it, so the
 * field, the document and the language it names are the ones the plain way in
 * names. A section already named is replaced: an address names one place.
 */
export function sectionAddress(href: string, sectionId: string): string {
  const [path = "", query = ""] = href.split("?", 2);
  const params = new URLSearchParams(query);
  params.set(SECTION_PARAM, sectionId);
  return `${path}?${params.toString()}`;
}

/**
 * The section an address's query names, or `undefined` where it names none.
 *
 * An empty value names none: there is no block with an empty id to open at.
 */
export function sectionFromSearch(search: string): string | undefined {
  const value = new URLSearchParams(search).get(SECTION_PARAM);
  return value === null || value === "" ? undefined : value;
}
