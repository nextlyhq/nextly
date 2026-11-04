/**
 * How the inspector's image fields read a stored media id: through the
 * admin's media read, the same one the canvas draws images with, so a file is
 * read once and both see it alike.
 *
 * @module media-summary-reader
 */
import { useMediaResolver } from "@nextlyhq/plugin-sdk/admin";
import { useCallback } from "react";

/** What an image field shows of a media item. */
export interface MediaSummary {
  readonly name?: string;
  readonly thumbnail?: string;
  readonly alt?: string;
}

/** Read one media item's summary by its id, or `null` for none. */
export type ReadMediaSummary = (
  mediaId: string
) => Promise<MediaSummary | null>;

/** The parts of an admin media item a summary is made from. */
interface MediaItem {
  readonly url: string;
  readonly thumbnailUrl?: string | null;
  readonly filename?: string;
  readonly originalFilename?: string | null;
  readonly altText?: string | null;
  readonly mimeType?: string | null;
}

/**
 * The name as the author uploaded it, else as stored; the thumbnail, else the
 * file itself when it is an image (a PDF's address drawn as a picture is a
 * broken one); and the alt text only when there is some.
 */
function summaryOf(item: MediaItem | null): MediaSummary | null {
  if (item === null) return null;
  const name = item.originalFilename || item.filename;
  const thumbnail = item.thumbnailUrl || (isImage(item) ? item.url : "");
  return {
    ...(name ? { name } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    ...(item.altText ? { alt: item.altText } : {}),
  };
}

/** Whether the item is a picture, by the type its upload settled on. */
function isImage(item: MediaItem): boolean {
  return item.mimeType?.startsWith("image/") === true;
}

/** The inspector's media read, stable for the editor's life. */
export function useMediaSummaryReader(): ReadMediaSummary {
  const readMedia = useMediaResolver();
  return useCallback(
    async (mediaId: string) => summaryOf(await readMedia(mediaId)),
    [readMedia]
  );
}
