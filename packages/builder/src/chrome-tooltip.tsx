/**
 * The editor chrome's tooltip: the one every control beside the canvas uses.
 *
 * Two things the shared `@nextlyhq/ui` tooltip cannot know, because they are
 * the editor's:
 *
 * - **The canvas is a frame.** A pointer leaving a control for the canvas
 *   passes into another document, so this one sees no further move, and Radix,
 *   waiting to learn whether the pointer is heading for the tooltip, kept it
 *   open over the canvas. The frame's own element does receive `pointerover`
 *   as the pointer enters it, so that closes the tooltip. Moving onto the
 *   tooltip itself still keeps it (WCAG 1.4.13), and so does keyboard focus on
 *   its control: for an icon-only control the tooltip is its only visible
 *   name, and the author is still on it.
 * - **Rows sit close.** Below its control by default, over the next row, which
 *   the author is not reading while pointing here; above, it covered the value
 *   of the row before. Kept clear of the panel's edges.
 *
 * Each surface keeps its own `TooltipProvider`, which sets the delay.
 *
 * @module chrome-tooltip
 */
import { Tooltip, TooltipContent, TooltipTrigger } from "@nextlyhq/ui";
import * as React from "react";

import { isIFrame } from "./dom-kind";

/** How far a tooltip keeps from the edges of what holds it, in pixels. */
const COLLISION_PADDING = 8;

export interface ChromeTooltipProps {
  /** What the tooltip says. */
  content: React.ReactNode;
  /** The control it names: one element, which becomes the trigger. */
  children: React.ReactElement;
  /** Which side of the control it opens on; below when absent. */
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Classes for the tooltip's content. */
  className?: string;
  /**
   * Keeps the tooltip closed while its control stays wrapped: a control whose
   * tooltip comes and goes keeps one element, so focus on it survives.
   */
  disabled?: boolean;
}

/**
 * A tooltip's open state that also closes when the pointer moves into a frame,
 * unless its control has keyboard focus.
 */
function useClosedByFrames(): {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.RefObject<HTMLButtonElement | null>;
} {
  const [open, setOpen] = React.useState(false);
  const trigger = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const intoFrame = (event: PointerEvent) => {
      if (!isIFrame(event.target)) return;
      // `:focus-visible`, not focus: a clicked control keeps focus too, and
      // its tooltip was opened by the pointer that has now left it.
      if (trigger.current?.matches(":focus-visible") === true) return;
      setOpen(false);
    };
    // The trigger's own document: the shell can be drawn inside a frame of
    // its own, where the canvas frame's events never reach the outer one.
    const at = trigger.current?.ownerDocument ?? document;
    at.addEventListener("pointerover", intoFrame, true);
    return () => at.removeEventListener("pointerover", intoFrame, true);
  }, [open]);
  return { open, onOpenChange: setOpen, trigger };
}

export function ChromeTooltip({
  content,
  children,
  side = "bottom",
  align = "center",
  className,
  disabled = false,
}: ChromeTooltipProps): React.JSX.Element {
  const { trigger, open, onOpenChange } = useClosedByFrames();
  return (
    <Tooltip open={open && !disabled} onOpenChange={onOpenChange}>
      <TooltipTrigger asChild ref={trigger}>
        {children}
      </TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        collisionPadding={COLLISION_PADDING}
        {...(className === undefined ? {} : { className })}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
