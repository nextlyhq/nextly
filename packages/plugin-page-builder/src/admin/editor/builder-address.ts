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
  const elsewhere =
    locale?.documentLocalized === true && !locale.isDefaultLocale
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
