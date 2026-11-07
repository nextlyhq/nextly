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
 * Whether a form path runs through a repeater's row. A row is addressed by its
 * position (`sections.0.body`), and a position names a different row once the
 * rows are reordered, so an address carrying one could open the wrong row's
 * field. Only a repeater's rows are numbered; a group step is always a name.
 */
function insideRepeater(path: string): boolean {
  return path.split(".").some(step => /^\d+$/.test(step));
}

/**
 * The builder's address for `fieldName` on the document the form holds.
 *
 * `fieldName` is the field's form path: `layout` at the top level,
 * `hero.body` inside a named group, which the view reaches by the same path.
 *
 * Withheld, with the sentence the card shows, where there is no address to
 * open: outside a document, on an entry that has never been saved, and for a
 * field inside a repeater, which the view does not reach.
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
  if (insideRepeater(fieldName)) {
    return {
      unavailable:
        "The Page Builder doesn't open for a field inside a repeater. Move this field out of the repeater to edit it visually.",
    };
  }
  const query = `?field=${encodeURIComponent(fieldName)}`;
  if (identity.kind === "single") {
    return {
      href: `${singleBuilderPath(identity.slug)}${query}`,
      ...elsewhere,
    };
  }
  if (identity.documentId === undefined) {
    return { unavailable: "Save this page to open the Page Builder." };
  }
  return {
    href: `${documentBuilderPath(identity.slug, identity.documentId)}${query}`,
    ...elsewhere,
  };
}

/**
 * The Page Builder view of a Single, naming no field, as
 * {@link documentBuilderPath} is for a collection's document: a Single is
 * addressed by its slug alone, having one document.
 */
export function singleBuilderPath(slug: string): string {
  return `/admin/singles/${encodeURIComponent(slug)}/${BUILDER_VIEW_PATH}`;
}

/**
 * The Page Builder view of a document in a collection, naming no field: the
 * admin opens the document's one blocks field, or asks which where it has
 * several. The path every address of a collection document's view starts
 * from.
 */
export function documentBuilderPath(collection: string, id: string): string {
  return `/admin/collections/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/${BUILDER_VIEW_PATH}`;
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

/** The same address naming no section, for a return that opens at the top. */
export function addressWithoutSection(href: string): string {
  const [path = "", query = ""] = href.split("?", 2);
  const params = new URLSearchParams(query);
  params.delete(SECTION_PARAM);
  const rest = params.toString();
  return rest === "" ? path : `${path}?${rest}`;
}

/**
 * The query key naming a block, at any depth, the builder opens at: what a
 * report of a page's broken bindings links each binding's block by.
 */
const BLOCK_PARAM = "block";

/** The builder's address `href`, opened at the block `blockId`. */
export function blockAddress(href: string, blockId: string): string {
  const [path = "", query = ""] = href.split("?", 2);
  const params = new URLSearchParams(query);
  params.set(BLOCK_PARAM, blockId);
  return `${path}?${params.toString()}`;
}

/**
 * The block an address opens the builder at: the section it names, else the
 * block; `undefined` where it names neither.
 */
export function openAtFromSearch(search: string): string | undefined {
  const block = new URLSearchParams(search).get(BLOCK_PARAM);
  return sectionFromSearch(search) ?? (block === null || block === "" ? undefined : block);
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
