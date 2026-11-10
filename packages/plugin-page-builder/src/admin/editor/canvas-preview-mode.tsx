"use client";

/**
 * The site mode (Light or Dark) the author picked to preview the page in,
 * held once for the surfaces that read it: the Design panel's preview switch
 * picks it, the canvas is drawn in it, and the tag over the canvas says so
 * and clears it.
 *
 * Held for the editing session only, in plain component state: nothing is
 * stored, so a reload draws the page's own mode again, and a published page
 * and its Preview never see it. The pick reaches the canvas frame's document
 * and the frame element alone, never the editor's own chrome.
 *
 * @module canvas-preview-mode
 */
import type { TokenMode } from "@nextlyhq/blocks-engine";
import {
  CanvasPreviewTags,
  type VariablesPreview,
} from "@nextlyhq/builder/shell";
import { useMemo, useState, type JSX } from "react";

/** The picked mode, the switch's way to pick one, and the tag's way back. */
export interface CanvasPreviewMode extends VariablesPreview {
  /** Back to the page's own mode: nothing picked. */
  readonly clear: () => void;
}

export function useCanvasPreviewMode(): CanvasPreviewMode {
  const [picked, setPicked] = useState<TokenMode | null>(null);
  return useMemo(
    () => ({ picked, onPick: setPicked, clear: () => setPicked(null) }),
    [picked]
  );
}

/** What the canvas frame is drawn with of the previews in hand. */
export interface PreviewedCanvas {
  /** The frame's `theme`: the picked mode, or nothing to draw the page's own. */
  readonly theme: TokenMode | undefined;
  /** The one row of tags over the canvas, for the frame's pinned chrome. */
  readonly tags: JSX.Element;
}

/**
 * The canvas frame's share of the picked mode and of the variant previewed:
 * ONE answer for the theme the frame draws and the tags drawn over it, so the
 * tag never says a mode the canvas is not drawn in.
 */
export function previewedCanvas(
  mode: CanvasPreviewMode,
  variant: string | undefined
): PreviewedCanvas {
  return {
    theme: mode.picked ?? undefined,
    tags: (
      <CanvasPreviewTags
        variant={variant}
        mode={mode.picked}
        onUseDevice={mode.clear}
      />
    ),
  };
}
