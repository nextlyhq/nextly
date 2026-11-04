/**
 * The page context the editor's canvas draws under.
 *
 * The canvas renders the page in the browser, and a block reads what it draws
 * through its page context: an image resolves its media item there. Without a
 * context of its own the canvas drew under the renderer's stand-in, whose
 * media resolver answers nothing, so an image chosen from the media library
 * drew no picture at all while the published page showed it.
 *
 * ONE object for the editor's life. The renderer keeps an async block's
 * output per context, so the page drawn again for a selection does not run an
 * image or a button again and blink; a context made afresh per render would
 * be a different one each time and keep nothing.
 *
 * @module canvas-page-context
 */
import {
  createStandaloneContext,
  type PageContext,
  type ResolvedMedia,
} from "@nextlyhq/blocks-react";
import { useMediaResolver } from "@nextlyhq/plugin-sdk/admin";
import { useMemo } from "react";

/** What a media item read through the admin gives a block to draw. */
interface MediaItem {
  readonly url: string;
  readonly altText?: string | null;
  readonly width?: number | null;
  readonly height?: number | null;
}

/** A media item as a block draws it, or `null` for none. */
function drawnMedia(item: MediaItem | null): ResolvedMedia | null {
  if (item === null) return null;
  return {
    url: item.url,
    ...(item.altText ? { alt: item.altText } : {}),
    ...(item.width ? { width: item.width } : {}),
    ...(item.height ? { height: item.height } : {}),
  };
}

/**
 * The canvas's page context: its images resolve through the admin's media
 * read, which caches each item by id and shares a read in flight.
 */
export function useCanvasPageContext(): PageContext {
  const readMedia = useMediaResolver();
  return useMemo(
    () =>
      createStandaloneContext({
        resolveMedia: async id => drawnMedia(await readMedia(id)),
      }),
    [readMedia]
  );
}
