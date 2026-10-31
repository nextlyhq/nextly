"use client";

/**
 * The upload tray, with its code loaded apart from the media library's.
 *
 * The library and the upload drop area are reached from the admin's entry, so
 * what they import statically loads before the first screen of every route.
 * The tray has nothing to show until files are chosen or dropped, so it comes
 * in its own chunk, asked for as the library or drop area mounts: it is in
 * place well before the first upload, and its live region with it.
 *
 * @module components/features/media-library/UploadTray/LazyUploadTray
 */

import { lazy, Suspense, type JSX } from "react";

import type { UploadTrayProps } from ".";

const UploadTray = lazy(() =>
  import(".").then(m => ({ default: m.UploadTray }))
);

/** {@link UploadTray}, drawn once its code has arrived; nothing before that. */
export function LazyUploadTray(props: UploadTrayProps): JSX.Element {
  return (
    <Suspense fallback={null}>
      <UploadTray {...props} />
    </Suspense>
  );
}
