"use client";

/**
 * An Image's empty state on the editor's canvas, with the admin's media
 * library behind it: its upload, through the library's own upload route and
 * its checks (the types and size the site accepts, and the author's right to
 * upload), and its picker.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/canvas-image-states
 */
import { ImageStates, type ImageStatesProps } from "@nextlyhq/builder/shell";
import { MediaPickerDialog, useUploadMedia } from "@nextlyhq/plugin-sdk/admin";
import { useCallback, useMemo } from "react";

type Services = NonNullable<ImageStatesProps["services"]>;

/** Upload one file to the media library, telling `onProgress` how far it is. */
export function useMediaUpload(): NonNullable<Services["uploadMedia"]> {
  const { mutateAsync } = useUploadMedia();
  return useCallback(
    async (file: File, onProgress?: (percent: number) => void) => {
      const media = await mutateAsync({
        file,
        ...(onProgress === undefined ? {} : { onProgress }),
      });
      return {
        id: media.id,
        url: media.url,
        filename: media.originalFilename || media.filename,
      };
    },
    [mutateAsync]
  );
}

/** The canvas's Image empty states, given the admin's media library. */
export function CanvasImageStates(
  props: Omit<ImageStatesProps, "services">
): React.JSX.Element {
  const uploadMedia = useMediaUpload();
  const services = useMemo(
    (): Services => ({ MediaPicker: MediaPickerDialog, uploadMedia }),
    [uploadMedia]
  );
  return <ImageStates {...props} services={services} />;
}
