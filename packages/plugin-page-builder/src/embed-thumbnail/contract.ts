/**
 * The thumbnail copy's contract: its path and what it answers, shared by the
 * route and the admin's client without the client reaching the server-only
 * route.
 *
 * @module @nextlyhq/plugin-page-builder/embed-thumbnail/contract
 */

/** Where the editor asks for a video's picture to be copied. */
export const EMBED_THUMBNAIL_ROUTE_PATH = "/embed-thumbnail";

/** What a copy answers: the media library file now holding the picture. */
export interface EmbedThumbnailResult {
  readonly id: string;
  readonly url: string;
  readonly filename: string;
  /** Whether an earlier copy of the same video's picture was answered. */
  readonly reused: boolean;
}
