/**
 * Preview links — minting one for an entry, and revoking all of them.
 *
 * Distinct from the Preview button beside it, and the difference is who the
 * link is for. Preview opens the entry in the site using the editor's own
 * session, including unsaved changes handed over through session storage; a
 * preview LINK is given to someone with no session at all, so it carries its
 * own signed authorization and can only ever show what was saved.
 *
 * @module services/previewLinkApi
 */

import { protectedApi } from "@admin/lib/api/protectedApi";

/**
 * What a mint request names: ONE collection entry, or ONE Single.
 *
 * A union rather than three optional fields, mirroring the endpoint's own
 * schema — so a caller cannot express "both", which names two different
 * documents, or "neither".
 */
export type PreviewLinkRequest =
  | {
      collection: string;
      entryId: string;
      single?: never;
      /** Restricts the link to one locale. Absent means every locale. */
      locale?: string;
    }
  | {
      single: string;
      collection?: never;
      entryId?: never;
      /** Restricts the link to one locale. Absent means every locale. */
      locale?: string;
    };

export interface PreviewLink {
  /** The signed token. */
  token: string;
  /**
   * The finished link, or `null` when the site's address is configured nowhere.
   *
   * Assembled on the server, which is the only place both halves are visible:
   * the site URL lives in settings the sharing roles cannot read, and the
   * preview route's mount point lives in the application's config, which the
   * browser cannot see at all.
   */
  url: string | null;
  /** ISO timestamp after which the link stops working. */
  expiresAt: string;
}

export const previewLinkApi = {
  /**
   * Mint a link for one entry.
   *
   * Requires `update` on the collection: someone who can edit an entry already
   * sees its draft, so sharing a link to that draft grants nothing new.
   */
  mint: async (request: PreviewLinkRequest): Promise<PreviewLink> => {
    const result = await protectedApi.post<{
      message: string;
      item: PreviewLink;
    }>("/preview-links", request);
    return result.item;
  },

  /**
   * Invalidate every preview link ever issued, including sessions already open.
   *
   * Requires `manage settings`, because the generation it moves is site-wide.
   */
  revokeAll: async (): Promise<{ generation: number }> => {
    const result = await protectedApi.post<{
      message: string;
      item: { generation: number };
    }>("/preview-links/revoke", {});
    return result.item;
  },
};
