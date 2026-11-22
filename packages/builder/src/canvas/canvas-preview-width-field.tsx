"use client";

/**
 * The width beside the device buttons, while the host previews other widths:
 * a button that swaps in a number field to type one, in the warning colour
 * with "Reset" beside it while a width other than the device's own is shown.
 *
 * @module canvas-preview-width-field
 */

import { cn } from "@nextlyhq/ui/utils";
import * as React from "react";

import { clampPreviewWidth, type PreviewWidthRange } from "./canvas-width";

/** The house focus ring, as the device buttons draw it. */
const FOCUS_RING =
  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-[color:var(--nx-builder-surface)] focus-visible:outline-none";

/**
 * The width shown, as a button to type another, and Reset while it is not
 * the device's own.
 *
 * @experimental
 */
export function PreviewWidthText({
  shown,
  previewing,
  deviceWidth,
  range,
  onPreviewWidth,
}: {
  /** The width the frame is laid out at. */
  shown: number;
  /** Whether that is a width other than the device's own. */
  previewing: boolean;
  deviceWidth: number;
  range: PreviewWidthRange;
  onPreviewWidth: (width: number | null) => void;
}): React.JSX.Element {
  const [typing, setTyping] = React.useState(false);
  const button = React.useRef<HTMLButtonElement | null>(null);
  const field = React.useRef<HTMLInputElement | null>(null);
  // Back to the button once the field goes, so focus is not lost with it.
  const refocus = React.useRef(false);

  React.useEffect(() => {
    if (typing) {
      field.current?.focus();
      field.current?.select();
    } else if (refocus.current) {
      refocus.current = false;
      button.current?.focus();
    }
  }, [typing]);

  const close = (): void => {
    refocus.current = true;
    setTyping(false);
  };

  /** Applies a typed width, in the range; the device's own width is none. */
  const apply = (typed: string): void => {
    const value = Number(typed);
    close();
    if (typed.trim() === "" || !Number.isFinite(value)) return;
    const width = clampPreviewWidth(value, range);
    onPreviewWidth(width === deviceWidth ? null : width);
  };

  const tone = previewing
    ? "text-[color:var(--nx-builder-warning-text)]"
    : undefined;

  return (
    <>
      {typing ? (
        <span className="inline-flex h-full items-center gap-0.5 px-1 text-xs">
          <input
            ref={field}
            type="number"
            aria-label="Preview width"
            min={range.min}
            max={range.max}
            defaultValue={shown}
            className="nx-preview-width__field h-full w-14 rounded border bg-transparent px-1 text-xs tabular-nums"
            onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply(event.currentTarget.value);
              } else if (event.key === "Escape") {
                event.preventDefault();
                // The field's Escape, not the editor's: the selection stays.
                event.stopPropagation();
                close();
              }
            }}
            // Leaving the field without Enter changes nothing.
            onBlur={() => setTyping(false)}
          />
          <span aria-hidden="true">px</span>
        </span>
      ) : (
        <button
          ref={button}
          type="button"
          data-nx-active-width=""
          {...(previewing ? { "data-previewing": "" } : {})}
          aria-label={`Preview width, ${String(shown)}px`}
          onClick={() => setTyping(true)}
          className={cn(
            "inline-flex h-full items-center rounded px-1.5 text-xs tabular-nums",
            FOCUS_RING,
            tone
          )}
        >
          {`${String(shown)}px`}
        </button>
      )}
      {previewing ? (
        <button
          type="button"
          onClick={() => {
            onPreviewWidth(null);
            // Reset goes with the width it resets, so focus moves to the width.
            button.current?.focus();
          }}
          className={cn(
            "inline-flex h-full items-center rounded px-1.5 text-xs font-medium",
            FOCUS_RING,
            "text-[color:var(--nx-builder-warning-text)]"
          )}
        >
          Reset
        </button>
      ) : null}
    </>
  );
}
