/**
 * Which page Settings reads the address of, and how its slug stands against
 * the one saved. Its own module, free of the dialog, so the editor that
 * gathers these facts does not load the dialog to do it.
 *
 * @module admin/editor/settings-address
 */
import type { PageReference } from "../../pages-search-contract";

/**
 * The page whose address Settings shows, and how its slug stands: the address
 * is read as the page is SAVED, so a slug typed since reads as a change still
 * to come.
 */
export interface SettingsAddress {
  readonly page: PageReference;
  /** The language being edited, which a localized slug is read in. */
  readonly locale?: string;
  /** The slug as saved, which the address read is for. */
  readonly savedSlug?: string;
  /** Whether the slug on screen differs from the one saved. */
  readonly slugChanged: boolean;
}

/**
 * The address Settings reads for the document on screen: a saved collection
 * entry, by its collection and id, with whether the slug typed since differs
 * from the saved one. `null` for a document never saved, or a Single, which
 * has no page address to read.
 */
export function settingsAddressOf(
  identity: { kind: string; slug: string; documentId?: string } | null,
  slug: unknown,
  savedSlug: unknown
): Omit<SettingsAddress, "locale"> | null {
  if (identity?.kind !== "collection" || identity.documentId === undefined) {
    return null;
  }
  const saved = typeof savedSlug === "string" ? savedSlug : undefined;
  return {
    page: { collection: identity.slug, id: identity.documentId },
    ...(saved === undefined ? {} : { savedSlug: saved }),
    slugChanged: typeof slug === "string" && slug !== saved,
  };
}
