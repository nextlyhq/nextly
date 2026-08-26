/**
 * Preview links — minting one for an entry, and revoking all of them.
 *
 * Both the Preview button and the shareable link mint one, and the difference
 * is who it is for rather than how it works. The site renders on its own
 * origin, where the admin's session does not reach and where the admin cannot
 * set a cookie, so a signed token is the only way either of them can turn draft
 * mode on. Preview mints one for the editor themself and spends it immediately;
 * a LINK is handed to someone with no session at all.
 *
 * Both can only ever show what was SAVED. The token authorizes a document, not
 * a set of values.
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
      /**
       * How long the link stays valid. Absent takes the server's sharing
       * default, which is the right length for a link that travels; a caller
       * spending the token immediately should ask for less.
       */
      ttlSeconds?: number;
    }
  | {
      single: string;
      collection?: never;
      entryId?: never;
      /** Restricts the link to one locale. Absent means every locale. */
      locale?: string;
      /** As above. */
      ttlSeconds?: number;
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
  /**
   * Whether a browser showing this admin will carry the preview session into a
   * FRAME pointed at `url`.
   *
   * Answered by the server for the same reason `url` is: only it can see both
   * halves. The site's address is one, and the attribute the preview cookie is
   * set with is the other — and that attribute is what decides whether the
   * session survives being framed. The browser comparing the two origins itself
   * was a second implementation of a question the cookie already settles, right
   * only while nobody changed the cookie.
   *
   * It says the SESSION reaches a frame, not that the frame will LOAD. An
   * application's own `frame-ancestors` is invisible from the server.
   */
  embeddable: boolean;
  /**
   * The viewport widths this preview offers, already resolved.
   *
   * The server sends a LIST rather than a source, because a collection may
   * declare its widths as a FUNCTION — a plugin holding the site's breakpoints
   * supplies one that reads them — and a function can neither be stored nor
   * sent. Resolving there is what lets the browser offer a site's own
   * breakpoints without the admin depending on whatever owns them.
   *
   * Empty means none were declared, which is different from the key being
   * absent: absent would leave a caller unable to tell "none" from "the server
   * did not answer".
   */
  viewports: PreviewViewport[];
}

/** One offered viewport: a name an author picked, and a width in CSS pixels. */
export interface PreviewViewport {
  label: string;
  width: number;
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
