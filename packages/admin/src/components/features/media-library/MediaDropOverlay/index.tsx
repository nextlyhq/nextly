"use client";

/**
 * MediaDropOverlay
 *
 * What the library shows while files are dragged over it: a drop target over
 * the whole page, naming the folder the files will go to and the types and
 * size it takes. It lets the pointer through (`pointer-events-none`), so the
 * drop lands on the page beneath it, which is what takes the files.
 *
 * The label keeps to the middle of the screen while the page scrolls under
 * it, since the page can be taller than the window.
 */

import * as React from "react";

import { Upload } from "@admin/components/icons";

export interface MediaDropOverlayProps {
  /** Where the files will go: the folder on screen, or the library's root. */
  destination: string;
  /** The types and per-file size the drop takes. */
  description: string;
}

export function MediaDropOverlay({
  destination,
  description,
}: MediaDropOverlayProps): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 rounded-lg border-2 border-dashed border-primary bg-background/85">
      <div className="sticky top-[35dvh] flex flex-col items-center gap-2 px-4 py-8 text-center">
        <Upload className="h-8 w-8 text-primary" aria-hidden="true" />
        <p className="text-lg font-semibold text-foreground">
          Drop to upload to {destination}
        </p>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
