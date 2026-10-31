"use client";

/**
 * The upload tray, with its code loaded apart from the media library's.
 *
 * The library and the upload drop area are reached from the admin's entry, so
 * what they import statically loads before the first screen of every route.
 * The tray has nothing to show until files are chosen or dropped, so it comes
 * in its own chunk, asked for as the library or drop area mounts. Its live
 * region does not wait for that chunk: it is drawn here, outside the boundary,
 * so it is mounted before any upload can start, however slowly the tray's code
 * arrives, and it stays the same element once the tray is drawn.
 *
 * @module components/features/media-library/UploadTray/LazyUploadTray
 */

import { lazy, Suspense, type JSX } from "react";

import { UploadLiveRegion } from "./UploadLiveRegion";
import type { UploadTrayProps } from ".";

const UploadTray = lazy(() =>
  import(".").then(m => ({ default: m.UploadTray }))
);

/**
 * The uploads' live region at once, and {@link UploadTray} once its code has
 * arrived; nothing visible before that.
 */
export function LazyUploadTray(props: UploadTrayProps): JSX.Element {
  return (
    <>
      <UploadLiveRegion queue={props.queue} />
      <Suspense fallback={null}>
        <UploadTray {...props} />
      </Suspense>
    </>
  );
}
