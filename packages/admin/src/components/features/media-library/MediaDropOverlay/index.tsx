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
    // `-inset-3`: the dashed edge sits in the page's margin, around the
    // library's content rather than across its breadcrumb and toolbar.
    <div className="pointer-events-none absolute -inset-3 z-30 rounded-lg border-2 border-dashed border-primary bg-background/85">
      <div className="sticky top-[35dvh] flex justify-center px-4 py-8">
        {/* A solid surface under the words: through the veil alone, a solid
            control beneath (the pager's current page) showed behind them. */}
        <div className="flex max-w-md flex-col items-center gap-2 rounded-lg bg-background px-6 py-5 text-center">
          <Upload className="h-8 w-8 text-primary" aria-hidden="true" />
          <p className="text-lg font-semibold text-foreground">
            Drop to upload to {destination}
          </p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}
