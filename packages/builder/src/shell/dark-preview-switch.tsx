"use client";

/**
 * The top bar's light and dark preview: a sun and a moon in one control,
 * beside the device buttons, that draws the canvas and the Design panel's
 * swatches with the site's dark values while it is pressed.
 *
 * One toggle button rather than a pair: there are two states, so assistive
 * technology hears one control, "Preview in dark mode", pressed or not. The
 * sun and the moon inside are drawn as the two halves of a segmented control,
 * the shown mode's half filled, which is how the device buttons beside it say
 * which device is shown.
 *
 * It holds nothing itself. The host keeps the mode, draws the canvas in it,
 * and decides when the switch is offered at all; the tooltip says what the
 * host guarantees, that it is a preview only.
 *
 * @module shell/dark-preview-switch
 */
import type { TokenMode } from "@nextlyhq/blocks-engine";
import { TooltipProvider } from "@nextlyhq/ui";
import { cn } from "@nextlyhq/ui/utils";
import { Moon, Sun } from "lucide-react";
import type * as React from "react";

import { ChromeTooltip } from "../chrome-tooltip";
import { DARK_PREVIEW_WORDS } from "../editor-words";

/** @experimental Settles with the canvas's mode preview. */
export interface DarkPreviewSwitchProps {
  /** The mode the canvas is previewed in. */
  mode: TokenMode;
  /** The author asked for the other mode. */
  onMode: (mode: TokenMode) => void;
}

const FOCUS_RING =
  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-[color:var(--nx-builder-surface)] focus-visible:outline-none";

/**
 * The switch, one control high like the device buttons, with its border and
 * padding inside that height. It keeps its own tooltip provider, as each
 * surface of the editor's chrome does, so a host can place it anywhere.
 *
 * @experimental Settles with the canvas's mode preview.
 */
export function DarkPreviewSwitch({
  mode,
  onMode,
}: DarkPreviewSwitchProps): React.JSX.Element {
  const dark = mode === "dark";
  return (
    <TooltipProvider delayDuration={300}>
      <ChromeTooltip content={DARK_PREVIEW_WORDS.tooltip}>
        <button
          type="button"
          aria-label={DARK_PREVIEW_WORDS.name}
          aria-pressed={dark}
          onClick={() => onMode(dark ? "light" : "dark")}
          className={cn(
            "nx-dark-preview-switch inline-flex h-[var(--nx-builder-control-height,1.75rem)] items-center gap-0.5 rounded-md border p-0.5",
            FOCUS_RING
          )}
        >
          <Side mode="light" on={!dark} />
          <Side mode="dark" on={dark} />
        </button>
      </ChromeTooltip>
    </TooltipProvider>
  );
}

/** One half: the sun or the moon, filled while its mode is the one shown. */
function Side({
  mode,
  on,
}: {
  mode: TokenMode;
  on: boolean;
}): React.JSX.Element {
  const Icon = mode === "dark" ? Moon : Sun;
  return (
    <span
      data-side={mode}
      data-on={on}
      aria-hidden="true"
      className={cn(
        "inline-flex h-full items-center rounded px-2",
        on ? "bg-accent text-accent-foreground" : "text-muted-foreground"
      )}
    >
      <Icon className="size-3.5" />
    </span>
  );
}
