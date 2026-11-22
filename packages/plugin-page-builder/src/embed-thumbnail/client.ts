"use client";

/**
 * The admin's side of "Use the video's thumbnail": asks the thumbnail-copy
 * route to copy a video's picture into the media library, and answers the
 * library file the Embed's poster then names.
 *
 * @module @nextlyhq/plugin-page-builder/embed-thumbnail/client
 */
import { writePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

// The CONTRACT, not the route: the route reaches the media library through
// server-only modules.
import {
  EMBED_THUMBNAIL_ROUTE_PATH,
  type EmbedThumbnailResult,
} from "./contract";

/** The canonical mutation envelope the route answers with. */
interface Envelope {
  readonly message: string;
  readonly item: EmbedThumbnailResult;
}

/**
 * Copy the picture of the video `link` names into the media library, or
 * find the copy made before. Rejects with the route's refusal when the
 * picture could not be copied.
 */
export async function copyEmbedThumbnail(
  link: string
): Promise<{ id: string; url: string; filename: string }> {
  const answer = await writePluginRoute<Envelope>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: EMBED_THUMBNAIL_ROUTE_PATH,
    body: { link },
  });
  if (answer?.item === undefined) {
    throw new Error("The thumbnail copy answered nothing.");
  }
  const { id, url, filename } = answer.item;
  return { id, url, filename };
}
