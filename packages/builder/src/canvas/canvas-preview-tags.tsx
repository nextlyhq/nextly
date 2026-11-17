"use client";

/**
 * The tags over the canvas saying it is not drawn as it would be by default:
 * today, the variant of a component previewed.
 *
 * They sit in ONE row at the frame's top right, where the variant's tag has
 * always been, so a tag added later is read beside it and never drawn over
 * it. The row is drawn only while a tag is.
 *
 * The site's light or dark preview has no tag: the top bar's switch shows
 * which mode the canvas is drawn in, wherever the author is in the editor.
 *
 * @module canvas-preview-tags
 */
import * as React from "react";

import { VariantPreviewTag } from "../variant-preview";

/** @experimental Settles with the canvas's mode preview. */
export interface CanvasPreviewTagsProps {
  /** The name of the variant the canvas previews, or nothing. */
  variant: string | undefined;
}

/**
 * The row of preview tags over the canvas; nothing while the canvas previews
 * no variant.
 *
 * @experimental Settles with the canvas's mode preview.
 */
export function CanvasPreviewTags({
  variant,
}: CanvasPreviewTagsProps): React.JSX.Element | null {
  if (variant === undefined) return null;
  return (
    <div className="nx-canvas-tags">
      <VariantPreviewTag name={variant} />
    </div>
  );
}
