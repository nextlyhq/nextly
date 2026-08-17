/**
 * Where an entry previews, answered by the server.
 *
 * The admin cannot compute this itself. A code-first collection declares its
 * preview as a function of the entry, which exists only in the server's module
 * graph and no column can hold — and the site URL the result is based on lives
 * behind a `settings` permission that the `editor` and `author` roles do not
 * have, which are exactly the roles that preview content. So the panel asks for
 * a finished URL rather than the parts to build one.
 *
 * @module services/previewUrlApi
 */

import { protectedApi } from "@admin/lib/api/protectedApi";

export interface PreviewUrlRequest {
  collection: string;
  /**
   * The entry as it stands on screen, unsaved edits included. The server
   * resolves against these values rather than the saved row, because an editor
   * previews what they are looking at.
   */
  entry: Record<string, unknown>;
}

/**
 * The server's answer, kept as four cases rather than a nullable URL.
 *
 * Three of them mean "no preview to open", and collapsing them would lose the
 * only distinction that matters to a caller trying to recover: `noSiteUrl` is
 * the one where an origin is guessable and guessing yields the admin's own host,
 * which produces a confident link to the wrong place.
 */
export type PreviewUrlResolution =
  | { status: "resolved"; url: string }
  | { status: "notConfigured" }
  | { status: "unavailable" }
  | { status: "noSiteUrl"; path: string };

export const previewUrlApi = {
  /**
   * Resolve the preview URL for one entry's current values.
   *
   * Requires `read` on the collection — weaker than minting a preview LINK,
   * which hands out a bearer credential. This returns a URL and no credential,
   * so it shows the caller only what their own session already permits.
   */
  resolve: (request: PreviewUrlRequest): Promise<PreviewUrlResolution> =>
    protectedApi.post<PreviewUrlResolution>("/preview-url", request),
};
