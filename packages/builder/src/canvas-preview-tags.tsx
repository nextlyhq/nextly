"use client";

/**
 * The tags over the canvas saying it is not drawn as it would be by default:
 * the variant of a component previewed, and the site mode (Light or Dark) the
 * author picked to preview the page in.
 *
 * Both sit in ONE row at the frame's top right, where the variant's tag has
 * always been, so the two are read side by side and never drawn over each
 * other. The row is drawn only while one of them is.
 *
 * The mode's tag carries the way back, "Use device", since the Design panel
 * that picked the mode may be closed by then: the pick lasts for the editing
 * session, and the tag is what says why the canvas looks as it does.
 *
 * @module canvas-preview-tags
 */
import type { TokenMode } from "@nextlyhq/blocks-engine";
import { Moon, Sun } from "lucide-react";
import * as React from "react";

import { VariantPreviewTag } from "./variant-preview";

/** @experimental Settles with the canvas's mode preview. */
export interface CanvasPreviewTagsProps {
  /** The name of the variant the canvas previews, or nothing. */
  variant: string | undefined;
  /**
   * The site mode the author picked for the canvas, or `null` while the
   * canvas draws the page's own mode.
   */
  mode: TokenMode | null;
  /** Clear the picked mode, so the canvas draws the page's own again. */
  onUseDevice: () => void;
}

/**
 * The row of preview tags over the canvas; nothing while the canvas previews
 * neither a variant nor a picked mode.
 *
 * @experimental Settles with the canvas's mode preview.
 */
export function CanvasPreviewTags({
  variant,
  mode,
  onUseDevice,
}: CanvasPreviewTagsProps): React.JSX.Element | null {
  if (variant === undefined && mode === null) return null;
  return (
    <div className="nx-canvas-tags">
      <VariantPreviewTag name={variant} />
      {mode === null ? null : (
        <ModePreviewTag mode={mode} onUseDevice={onUseDevice} />
      )}
    </div>
  );
}

/**
 * "Dark preview · Use device": the mode the canvas is drawn in, said as a
 * status so the change is announced, and a real button that clears it.
 */
function ModePreviewTag({
  mode,
  onUseDevice,
}: {
  mode: TokenMode;
  onUseDevice: () => void;
}): React.JSX.Element {
  const Icon = mode === "dark" ? Moon : Sun;
  return (
    <p className="nx-mode-preview-tag">
      <Icon size={14} aria-hidden="true" />
      <span role="status">
        {mode === "dark" ? "Dark preview" : "Light preview"}
      </span>
      <span className="nx-mode-preview-tag__dot" aria-hidden="true">
        ·
      </span>
      <button
        type="button"
        className="nx-mode-preview-tag__clear"
        onClick={onUseDevice}
      >
        Use device
      </button>
    </p>
  );
}
