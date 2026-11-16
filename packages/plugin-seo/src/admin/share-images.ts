/**
 * The SEO tab's share images: the one chosen for the page, the page's own
 * picture the automatic one is, and making a copy of the right size from
 * whichever is shown.
 *
 * @module admin/share-images
 */
import { useMediaItem, writePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { SHARE_IMAGE_ROUTE_PATH } from "../social/contract";
import { SEO_PLUGIN_NAME, type SeoTabContext } from "../tab/contract";

import { imageIdOf, type ChosenImage, type SeoPanelValues } from "./values";

/** A media document as the panel shows a chosen share image. */
function chosenImageOf(
  media: ReturnType<typeof useMediaItem>["data"]
): ChosenImage | undefined {
  if (media === undefined) return undefined;
  return {
    url: media.url,
    filename: media.originalFilename || media.filename,
    ...(typeof media.width === "number" ? { width: media.width } : {}),
    ...(typeof media.height === "number" ? { height: media.height } : {}),
    ...(media.altText ? { alt: media.altText } : {}),
    bytes: media.size,
    mimeType: media.mimeType,
  };
}

/**
 * A share image made from a picture: the new media document's id, or none
 * where the person may not add to the media library or the copy could not be
 * made.
 */
async function madeShareImage(mediaId: string): Promise<string | undefined> {
  try {
    const made = await writePluginRoute<{ item?: { id?: unknown } }>({
      plugin: SEO_PLUGIN_NAME,
      path: SHARE_IMAGE_ROUTE_PATH,
      body: { media: mediaId },
    });
    const id = made?.item?.id;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The page's share images: the one chosen for it, the page's own picture the
 * automatic one is, and the action that makes a copy of the right size from
 * whichever is shown, where there is one to make it from.
 */
export function useShareImages(
  document: Readonly<Record<string, unknown>>,
  values: SeoPanelValues,
  levels: SeoTabContext | undefined,
  documentKey: string,
  set: ((next: unknown) => boolean) | undefined
): {
  imageId: string | undefined;
  chosenImage: ChosenImage | undefined;
  contentImage: ChosenImage | undefined;
  make: (() => Promise<string | undefined>) | undefined;
} {
  const imageId = imageIdOf(values.ogImage);
  const chosenImage = useChosenImage(imageId);
  const contentField = levels?.levels.content.image?.field;
  const contentImageId =
    contentField === undefined ? undefined : imageIdOf(document[contentField]);
  const contentImage = useChosenImage(contentImageId);
  const source = imageId ?? contentImageId;
  // What a copy is made for: the document, its language and the picture. A
  // copy that comes back once any of them changed is not set on what is shown.
  const shown = `${documentKey}|${source ?? ""}`;
  const current = useRef(shown);
  useEffect(() => {
    current.current = shown;
  }, [shown]);
  const make = useCallback(async () => {
    if (source === undefined) return undefined;
    const id = await madeShareImage(source);
    if (id === undefined || current.current !== shown) return undefined;
    return set?.(id) === true ? id : undefined;
  }, [source, shown, set]);
  return {
    imageId,
    chosenImage,
    contentImage,
    make: source === undefined ? undefined : make,
  };
}

/** The chosen share image, read from the media library by its id. */
function useChosenImage(imageId: string | undefined): ChosenImage | undefined {
  const media = useMediaItem(imageId);
  return useMemo(
    () => (imageId === undefined ? undefined : chosenImageOf(media.data)),
    [imageId, media.data]
  );
}
